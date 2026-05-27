// Certificate of Origin — Phase 3B.
//
// Mirrors the template GENRYO ops shared (2026-05-27): EC4 logo +
// "CERTIFICATE OF ORIGIN" title header; Consignee / Notify boxes;
// invoice-reference table; consolidated goods table; Additional
// Information block with Country of Acquisition/Provenance/Origin
// + manufacturer line + treated-wood declaration; Exporter
// Declaration paragraph with signature line.
//
// Hooked into DeliveryDocsModal alongside Invoice / PL / SLI / BOL.
// Single column / portrait letter (matches the rest of the doc
// family). Generator returns the jsPDF doc so the caller can preview,
// download, or email-attach.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicePdfCtx, PdfInvoice } from './types';
import { latin1Safe } from './wrapText';

const TEAL = '#00A0B0';
const DARK = '#222222';
const SUB  = '#666666';
const RED  = '#C0392B';

const parseItems = (raw: unknown): any[] => {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch { return []; }
};

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-US'); }
  catch { return d; }
};

const fmtNum = (n: number, decimals = 2): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Treated-wood detection from inv.memo. The same memo line that the
 *  SLI uses to declare wood status drives the red marker on the COO
 *  — looking for either "TREATED WOOD" or "WOOD PRESENT" (any case).
 *  Default = NO WOOD (the safer / cheaper declaration). */
function detectWoodStatus(memo: string | null | undefined): { present: boolean; text: string } {
  const m = (memo || '').toUpperCase();
  if (m.includes('TREATED WOOD') || m.includes('WOOD PRESENT')) {
    return { present: true, text: 'TREATED WOOD PRESENT ON THE CARGO' };
  }
  return { present: false, text: 'NO WOOD PRESENT ON THE CARGO' };
}

export function generateCooPdf(
  inv: PdfInvoice,
  ctx: InvoicePdfCtx,
  autoDownload = false,
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();   // ~216mm letter
  const marginX = 14;
  const innerW = pageW - 2 * marginX;

  const company = ctx.company;
  const companyName    = company?.name    || 'EC4 ENTERPRISES LLC';
  const companyTagline = (company as any)?.tagline || 'THREE STRANDS ARE STRONGER';
  const companyAddress = company?.address || '112 Bartran Oaks Walk 600010';
  const companyCity    = `${company?.city || 'St Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} ${company?.country || 'US'}`;
  const companyPhone   = company?.phone   || '';
  const companyEmail   = (company as any)?.email || 'felipe@ec4.enterprises';
  const companyWeb     = (company as any)?.website || 'www.ec4.enterprises';
  const exporterCountry = (company?.country || 'US').toUpperCase() === 'US'
    ? 'UNITED STATES OF AMERICA'
    : (company?.country || '').toUpperCase();

  // Counterparty resolution — same case/whitespace-tolerant pattern
  // the invoice + SLI generators use.
  const normalize = (s: string) => (s ?? '').trim().toLowerCase();
  const findCust  = (name: string) => {
    const key = normalize(name);
    if (!key) return undefined;
    return ctx.customers.find(c => normalize(c.name) === key);
  };
  const consigneeName = inv.soldTo || inv.consignee || inv.billToName || '';
  const notifyName    = inv.billToName || inv.consignee || consigneeName;
  const consigneeCust = findCust(consigneeName)
    ?? ctx.customers.find(c => c.id === inv.customerId);
  const notifyCust    = findCust(notifyName) ?? consigneeCust;
  const fmtAddr = (c: typeof consigneeCust) => c
    ? [c.location, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
    : '';

  // ─── HEADER: logo + "CERTIFICATE OF ORIGIN" title ─────────────
  // Logo box left; title right-aligned. Title sits two lines (visual
  // match for the template: "CERTIFICATE" / "OF ORIGIN").
  if (ctx.logoUrl) {
    try {
      let format = 'PNG';
      if (ctx.logoUrl.startsWith('data:image/')) {
        const m = ctx.logoUrl.match(/data:image\/(\w+);/);
        if (m) { format = m[1].toUpperCase(); if (format === 'JPG') format = 'JPEG'; }
      }
      const props = doc.getImageProperties(ctx.logoUrl);
      const maxW = 32, maxH = 32;
      let w = props.width, h = props.height;
      const r = Math.min(maxW / w, maxH / h);
      w *= r; h *= r;
      doc.addImage(ctx.logoUrl, format, marginX, 12, w, h);
    } catch { /* fall through */ }
  }

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text('CERTIFICATE', pageW - marginX, 22, { align: 'right' });
  doc.text('OF ORIGIN',   pageW - marginX, 32, { align: 'right' });

  // ─── COMPANY BLOCK (below logo, top-left) ─────────────────────
  let y = 52;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text(latin1Safe(companyName), marginX, y);
  y += 5;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(SUB);
  doc.text(latin1Safe(companyTagline), marginX, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(DARK);
  doc.text(latin1Safe(companyAddress), marginX, y); y += 4;
  doc.text(latin1Safe(companyCity), marginX, y);    y += 4;
  if (companyPhone) { doc.text(`Tel: ${companyPhone}`, marginX, y); y += 4; }
  if (companyEmail || companyWeb) {
    const line = [companyEmail && `Email: ${companyEmail}`, companyWeb && `Web: ${companyWeb}`]
      .filter(Boolean).join('  •  ');
    doc.text(line, marginX, y); y += 4;
  }

  // ─── CONSIGNEE / NOTIFY PARTY (side-by-side bordered boxes) ───
  y += 4;
  const boxW = innerW / 2 - 2;
  const boxH = 36;
  const consigneeX = marginX;
  const notifyX    = marginX + innerW / 2 + 2;

  const drawPartyBox = (x: number, labelTxt: string, name: string, email: string | null | undefined, tax: string | null | undefined, addr: string) => {
    doc.setDrawColor('#cccccc');
    doc.setLineWidth(0.3);
    doc.rect(x, y, boxW, boxH);
    // Label
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(SUB);
    doc.text(labelTxt, x + 2, y + 4.5);
    // Name (bold)
    doc.setFontSize(9);
    doc.setTextColor(DARK);
    let yy = y + 9.5;
    const nameLines = doc.splitTextToSize(latin1Safe(name || '-'), boxW - 4);
    doc.text(nameLines, x + 2, yy);
    yy += nameLines.length * 3.8;
    // Address (normal)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (addr) {
      const addrLines = doc.splitTextToSize(latin1Safe(addr), boxW - 4);
      doc.text(addrLines, x + 2, yy);
      yy += addrLines.length * 3.5;
    }
    if (email) { doc.text(latin1Safe(`Email: ${email}`), x + 2, yy); yy += 3.5; }
    if (tax)   { doc.text(`CNPJ : ${tax}`, x + 2, yy); }
  };

  drawPartyBox(consigneeX, 'CONSIGNEE', consigneeName, consigneeCust?.email, consigneeCust?.taxId, fmtAddr(consigneeCust));
  drawPartyBox(notifyX,    'NOTIFY PARTY', notifyName, notifyCust?.email,    notifyCust?.taxId,    fmtAddr(notifyCust));
  y += boxH + 4;

  // ─── REFERENCE TABLE (single-row autoTable) ───────────────────
  const incoterm = inv.incoterm || 'CIF';
  const podCode  = inv.pod || '';
  const podPort  = ctx.ports.find(p => p.code === podCode);
  const podText  = podPort ? `${podPort.name}${podPort.code ? ` (${podPort.code})` : ''}` : (podCode || '-');

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    tableWidth: innerW,
    head: [['INVOICE REFERENCE', 'DATE', 'SALES ORDER #', 'BOOKING #', 'TERMS', 'PORT OF DISCHARGE (POD)']],
    body: [[
      inv.invoiceNumber || '-',
      fmtDate(inv.date || inv.invoiceDate),
      inv.soNumber || (inv as any).salesOrderNumber || '-',
      inv.bookingNumber || (inv as any).transportRef || '-',
      incoterm,
      podText,
    ]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, textColor: DARK, lineColor: '#cccccc', lineWidth: 0.2, cellPadding: 2 },
    headStyles: { fillColor: '#f4f6f8', textColor: DARK, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 22 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 18 },
      // last column flexes
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ─── GOODS TABLE ─────────────────────────────────────────────
  // Consolidate items by product description so multiple line items
  // for the same SKU collapse to one row. The Description cell
  // includes Container No / Seal No / Total Volumes below the
  // product name (matches the template).
  const items = parseItems(inv.items);
  type Row = { description: string; hsCode: string; netLbs: number; netKg: number; grossKg: number; container: string; seal: string; volumes: number };
  const rows: Row[] = [];
  const rmap = new Map<string, number>();
  items.forEach((it: any) => {
    const desc = (it.customerDescription || it.productName || it.description || '').trim() || '-';
    const hs   = (it.hsCode || '').trim();
    const key  = `${desc}|${hs}`;
    const lbs  = Number(it.netLbs ?? it.quantity ?? 0);
    const kg   = Number(it.netKg)  > 0 ? Number(it.netKg)  : lbs * 0.453592;
    const gkg  = Number(it.grossKg) > 0 ? Number(it.grossKg) : kg * 1.02;
    const cont = (it.containerNo || '').trim();
    const seal = (it.sealNo || '').trim();
    const vol  = Number(it.volumes || 0);
    const idx  = rmap.get(key);
    if (idx == null) {
      rmap.set(key, rows.length);
      rows.push({ description: desc, hsCode: hs, netLbs: lbs, netKg: kg, grossKg: gkg, container: cont, seal, volumes: vol });
    } else {
      const r = rows[idx];
      r.netLbs += lbs;
      r.netKg  += kg;
      r.grossKg += gkg;
      r.volumes += vol;
      if (!r.container && cont) r.container = cont;
      if (!r.seal && seal) r.seal = seal;
    }
  });
  // Fallback when no items exist — synthesize a single row from the
  // invoice-level totals so the certificate still has shape.
  if (rows.length === 0) {
    rows.push({
      description: '-', hsCode: '-',
      netLbs: Number((inv as any).netWeight || 0) / 0.453592,
      netKg:  Number((inv as any).netWeight || 0),
      grossKg: Number((inv as any).grossWeight || 0),
      container: (inv as any).containers || '',
      seal: '', volumes: Number((inv as any).totalVolumes || 0),
    });
  }

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    tableWidth: innerW,
    head: [['DESCRIPTION OF GOODS', 'HS CODE', 'QUANTITY (NET)', 'TOTAL GROSS WEIGHT']],
    body: rows.map(r => {
      // Description cell — product line bold, then container/seal/volumes
      // smaller. autoTable joins these with newlines.
      const extras: string[] = [];
      if (r.container) extras.push(`Container No: ${r.container}`);
      if (r.seal)      extras.push(`Seal No: ${r.seal}`);
      if (r.volumes > 0) extras.push(`Total Volumes: ${r.volumes}`);
      const desc = [r.description, ...extras].join('\n');
      const qty = `${fmtNum(r.netLbs)} lbs\n${fmtNum(r.netKg)} kg`;
      const gross = `${fmtNum(r.grossKg)} kg`;
      return [desc, r.hsCode || '-', qty, gross];
    }),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, textColor: DARK, lineColor: '#cccccc', lineWidth: 0.2, cellPadding: 2.5, valign: 'top' },
    headStyles: { fillColor: '#222222', textColor: '#ffffff', fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 78 },
      1: { cellWidth: 26, halign: 'left' },
      2: { cellWidth: 40, halign: 'left' },
      3: { cellWidth: 'auto', halign: 'left' },
    },
    // Bold the product-line of each description cell.
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ─── ADDITIONAL INFORMATION & MARKS (bordered box) ────────────
  const wood = detectWoodStatus(inv.memo);
  const boxAddY = y;
  const boxAddH = 30;
  doc.setDrawColor('#cccccc');
  doc.setLineWidth(0.3);
  doc.rect(marginX, boxAddY, innerW, boxAddH);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(SUB);
  doc.text('ADDITIONAL INFORMATION & MARKS', marginX + 2, boxAddY + 4.5);

  // Left column — country fields
  const colY = boxAddY + 10;
  const labelX = marginX + 3;
  const valueX = marginX + 50;
  doc.setFontSize(8.5);
  doc.setTextColor(DARK);
  doc.setFont('helvetica', 'bold'); doc.text('Country of Acquisition:', labelX, colY);
  doc.setFont('helvetica', 'normal'); doc.text('USA', valueX, colY);
  doc.setFont('helvetica', 'bold'); doc.text('Country of Provenance:', labelX, colY + 5);
  doc.setFont('helvetica', 'normal'); doc.text('USA', valueX, colY + 5);
  doc.setFont('helvetica', 'bold'); doc.text('Country of Origin:', labelX, colY + 10);
  doc.setFont('helvetica', 'bold'); doc.text('USA', valueX, colY + 10);

  // Right column — manufacturer + wood marker
  const rightX = marginX + innerW / 2 + 4;
  doc.setFont('helvetica', 'bold'); doc.text('Manufacturer:', rightX, colY);
  doc.setFont('helvetica', 'normal'); doc.text('Various generators', rightX + 26, colY);
  doc.setFont('helvetica', 'normal');
  doc.text('All goods collected and consolidated by EC4 ENTERPRISES LLC.', rightX, colY + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(wood.present ? RED : '#2E7D32');
  doc.text(wood.text, rightX, colY + 11);

  y = boxAddY + boxAddH + 4;

  // ─── EXPORTER DECLARATION & CERTIFICATION ────────────────────
  const boxDeclH = 50;
  doc.setDrawColor('#cccccc');
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, innerW, boxDeclH);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(SUB);
  doc.text('EXPORTER DECLARATION & CERTIFICATION', marginX + 2, y + 4.5);

  const paraY = y + 10;
  const paraLines = doc.splitTextToSize(
    `The undersigned, an authorized representative of ${companyName}, hereby declares that the merchandise described above ` +
    `originated in the ${exporterCountry}, and that the description, quantity, and weight listed herein perfectly conform to the ` +
    `details stated on Commercial Invoice #${inv.invoiceNumber || '-'}.`,
    innerW - 6,
  );
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(DARK);
  doc.text(paraLines, marginX + 3, paraY);

  // Signature line + stamp on the left
  const sigY = y + boxDeclH - 18;
  doc.setLineWidth(0.4);
  doc.setDrawColor('#222222');
  doc.line(marginX + 3, sigY, marginX + 90, sigY);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text('Authorized Signature:', marginX + 3, sigY - 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(SUB);
  doc.text(companyName, marginX + 3, sigY + 4);

  // EC4 stamp graphic above the signature line when available.
  if (ctx.stampUrl) {
    try {
      doc.addImage(ctx.stampUrl, 'PNG', marginX + 4, sigY - 22, 26, 22, undefined, 'NONE');
    } catch { /* skip */ }
  }

  // Right column — name / title / date
  const rcolX = marginX + innerW - 78;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(DARK);
  doc.text('Name / Title:', rcolX, sigY);
  doc.setFont('helvetica', 'normal');
  doc.text('Felipe Ribeiro Neublum / Managing Director', rcolX + 22, sigY);

  doc.setFont('helvetica', 'bold');
  doc.text('Date of Issue:', rcolX, sigY + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), rcolX + 22, sigY + 5);

  // Footer: cyan rule for visual continuity with the rest of the
  // doc family.
  doc.setDrawColor(TEAL);
  doc.setLineWidth(0.4);
  doc.line(marginX, 285, pageW - marginX, 285);

  if (autoDownload) {
    doc.save(`CertificateOfOrigin_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  return doc;
}
