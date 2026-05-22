// Phase 3B — Packing List PDF generator. Ported 1:1 from v1's
// `pages/PLInvoiceEngine.tsx::generatePackingListPDF`, closures
// replaced by an explicit `ctx` parameter.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicePdfCtx, PdfInvoice } from './types';
import { wrapByChars } from './wrapText';

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
  const companyEmail = company?.email || 'felipe@ec4.enterprises';
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

  // Consignee (bill to) / Notify (ship to) / Invoice info —
  // whitespace- and case-tolerant customer lookup so the addresses +
  // CNPJ render even when stored names carry trailing whitespace.
  const normalize = (s: string) => (s ?? '').trim().toLowerCase();
  const findCust = (name: string) => {
    const key = normalize(name);
    if (!key) return undefined;
    return ctx.customers.find(c => normalize(c.name ?? '') === key);
  };
  let y = 68;
  const consigneeName = inv.soldTo || inv.billToName || inv.consignee || '';
  const notifyName = inv.billToName || inv.consignee || consigneeName;
  const consigneeCust = findCust(consigneeName)
    ?? ctx.customers.find(c => c.id === inv.customerId);
  const notifyCust = findCust(notifyName) ?? consigneeCust;
  const fmtAddr = (c: typeof consigneeCust) => c
    ? [c.location, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
    : '';
  const consigneeAddress = fmtAddr(consigneeCust);
  const notifyAddress = fmtAddr(notifyCust);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text('CONSIGNEE', 14, y);
  doc.text('NOTIFY', 75, y);

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

  // Consignee (bill to) content
  y = 74;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let consigneeY = y;

  doc.setFont('helvetica', 'bold');
  const consigneeLines = wrapByChars(consigneeName, 30);
  doc.text(consigneeLines, 14, consigneeY);
  consigneeY += consigneeLines.length * 4;

  doc.setFont('helvetica', 'normal');
  if (consigneeAddress) {
    const lines = wrapByChars(consigneeAddress, 30);
    doc.text(lines, 14, consigneeY);
    consigneeY += lines.length * 4;
  }
  if (consigneeCust?.email) { doc.text(consigneeCust.email, 14, consigneeY); consigneeY += 4; }
  if (consigneeCust?.taxId) { doc.text(`CNPJ : ${consigneeCust.taxId}`, 14, consigneeY); }

  // Notify (ship to)
  let notifyY = y;
  doc.setFont('helvetica', 'bold');
  const notifyLines = wrapByChars(notifyName, 30);
  doc.text(notifyLines, 75, notifyY);
  notifyY += notifyLines.length * 4;

  doc.setFont('helvetica', 'normal');
  if (notifyAddress) {
    const lines = wrapByChars(notifyAddress, 30);
    doc.text(lines, 75, notifyY);
    notifyY += lines.length * 4;
  }
  if (notifyCust?.email) { doc.text(notifyCust.email, 75, notifyY); notifyY += 4; }
  if (notifyCust?.taxId) { doc.text(`CNPJ : ${notifyCust.taxId}`, 75, notifyY); }

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
      const itemsVol = contItems.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      // Use the container's own persisted `volumes` if items don't
      // attribute any (legacy rows where sanitizeItems stripped extras).
      const vols = itemsVol > 0 ? itemsVol : (Number(cont?.volumes) || 0);
      const netKg = contItems.reduce((s: number, i: any) => s + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
      const grossKg = contItems.reduce((s: number, i: any) => s + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
      return { container: cont.container || '-', seal: cont.seal || '-', volumes: vols, netKg, grossKg };
    });

    // Per-dimension fallback — before, we only back-filled when EVERY
    // dimension was zero. That missed the common case where containers
    // carry `volumes` (pre-filled in the drawer) but items lost their
    // `netKg/grossKg` during an older save. Now each dimension is
    // topped up independently: if the per-container column sums to 0,
    // distribute the invoice row-level fallback evenly.
    if (items.length > 0 && rows.length > 0) {
      const parseNum = (v: unknown): number => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
        if (typeof v === 'string') {
          const n = Number(v.replace(/[^\d.\-]/g, ''));
          return Number.isFinite(n) ? n : 0;
        }
        return 0;
      };
      const n = rows.length;
      const sumVol   = rows.reduce((s, r) => s + r.volumes, 0);

      // Source-of-truth: the invoice's saved gross/net/volumes fields.
      // When those are populated, override the per-row distribution so
      // the table TOTAL always matches the saved invoice — line items
      // drift when imported separately. Distribute proportionally to
      // each container's existing volumes (falls back to even split).
      const distribute = (total: number, key: 'volumes' | 'netKg' | 'grossKg') => {
        if (total <= 0) return;
        const totalVolForRatio = rows.reduce((s, r) => s + r.volumes, 0);
        if (totalVolForRatio > 0) {
          let assigned = 0;
          rows.forEach((r, i) => {
            if (i === rows.length - 1) {
              r[key] = key === 'volumes' ? Math.round(total - assigned) : total - assigned;
            } else {
              const share = (r.volumes / totalVolForRatio) * total;
              r[key] = key === 'volumes' ? Math.round(share) : share;
              assigned += r[key];
            }
          });
        } else {
          // No per-row volumes to use as ratio — split evenly.
          rows.forEach(r => { r[key] = key === 'volumes' ? Math.round(total / n) : total / n; });
          if (key === 'volumes') {
            const assigned = rows.reduce((s, r) => s + r.volumes, 0);
            if (assigned !== total) rows[0].volumes += (total - assigned);
          }
        }
      };

      // Volumes — first try invoice's saved totalVolumes, then container
      // JSON sum, then per-item volumes. Apply only when rows still
      // have no volumes assigned (preserve OCR-extracted per-container
      // volumes when those are present).
      if (sumVol === 0) {
        const containerSum = (containerData as any[]).reduce((s: number, c: any) => s + (Number(c?.volumes) || 0), 0);
        const itemsVol = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
        const total = parseNum((inv as any).totalVolumes ?? (inv as any).volumes)
          || (containerSum > 0 ? containerSum : itemsVol);
        distribute(total, 'volumes');
      }
      // Net + gross — invoice-saved values ALWAYS win when present.
      const invNet = parseNum((inv as any).netWeight);
      if (invNet > 0) {
        distribute(invNet, 'netKg');
      } else {
        const sumNet = rows.reduce((s, r) => s + r.netKg, 0);
        if (sumNet === 0) {
          const itemsNet = items.reduce((s: number, i: any) => s + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
          if (itemsNet > 0) distribute(itemsNet, 'netKg');
        }
      }
      const invGross = parseNum((inv as any).grossWeight);
      if (invGross > 0) {
        distribute(invGross, 'grossKg');
      } else {
        const sumGross = rows.reduce((s, r) => s + r.grossKg, 0);
        if (sumGross === 0) {
          const itemsGross = items.reduce((s: number, i: any) => s + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
          if (itemsGross > 0) distribute(itemsGross, 'grossKg');
        }
      }
    }

    const fmtN = (n: number) => n > 0 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    const fmtV = (n: number) => n > 0 ? n.toString() : '-';
    const head2 = [['CONTAINER NO.', 'SEAL NO.', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
    const body2 = rows.map(r => [
      r.container, r.seal, fmtV(r.volumes), fmtN(r.netKg), fmtN(r.grossKg),
    ]);

    // TOTAL row mirrors the row-distribution fallback above so the
    // bottom sum matches when items lack per-row weights.
    const totalVols  = rows.reduce((s, r) => s + r.volumes, 0);
    const totalNet   = rows.reduce((s, r) => s + r.netKg, 0);
    const totalGross = rows.reduce((s, r) => s + r.grossKg, 0);
    body2.push(['TOTAL', '', fmtV(totalVols), fmtN(totalNet), fmtN(totalGross)]);

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

  // Same row-level fallback as the per-container summary: if no item
  // reported a gross/net/volume, top up the aggregate from the
  // invoice-level `grossWeight` / `netWeight` / `totalVolumes` fields
  // so the product summary isn't stuck at zero.
  {
    const parseNum = (v: unknown): number => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'string') {
        const n = Number(v.replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };
    const entries = Object.values(productSummary);
    const sumNet   = entries.reduce((s, p) => s + p.netKg, 0);
    const sumGross = entries.reduce((s, p) => s + p.grossKg, 0);
    const sumVol   = entries.reduce((s, p) => s + p.volumes, 0);
    // Container-level volumes fallback — drawer-persisted `containers[].volumes`.
    const containerVolSum = (() => {
      try {
        const arr = typeof (inv as any).containers === 'string'
          ? JSON.parse((inv as any).containers || '[]')
          : ((inv as any).containers as any[] | undefined) || [];
        return (arr as any[]).reduce((s, c) => s + (Number(c?.volumes) || 0), 0);
      } catch { return 0; }
    })();
    if (entries.length > 0) {
      // Source-of-truth: the invoice's saved totals. When the user
      // typed gross/net/volumes on the invoice drawer, the product
      // summary must reflect those numbers — not whatever the line
      // items happen to add up to. Scale the per-product breakdown
      // proportionally so each product's slice is consistent with the
      // displayed grand total.
      const scaleTo = (target: number, key: 'netKg' | 'grossKg' | 'volumes', sum: number) => {
        if (target <= 0) return;
        if (sum > 0) {
          const ratio = target / sum;
          entries.forEach(p => { p[key] = key === 'volumes' ? Math.round(p[key] * ratio) : p[key] * ratio; });
        } else {
          entries[0][key] += target;
        }
      };
      const invNet   = parseNum((inv as any).netWeight);
      const invGross = parseNum((inv as any).grossWeight);
      const invVol   = parseNum((inv as any).totalVolumes ?? (inv as any).volumes) || containerVolSum;
      if (invNet   > 0) scaleTo(invNet,   'netKg',   sumNet);
      if (invGross > 0) scaleTo(invGross, 'grossKg', sumGross);
      if (invVol   > 0) scaleTo(invVol,   'volumes', sumVol);
    }
  }

  const productRows = Object.values(productSummary);
  if (productRows.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(darkGray);
    doc.text('SUMMARY BY PRODUCT', 14, finalY);
    finalY += 5;

    const fmtN = (n: number) => n > 0 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    const fmtV = (n: number) => n > 0 ? n.toString() : '-';
    const head3 = [['PRODUCT DESCRIPTION', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
    const body3 = productRows.map(p => [
      p.description.length > 60 ? p.description.substring(0, 60) + '...' : p.description,
      fmtV(p.volumes),
      fmtN(p.netKg),
      fmtN(p.grossKg),
    ]);

    const grandVol = productRows.reduce((s, p) => s + p.volumes, 0);
    const grandNet = productRows.reduce((s, p) => s + p.netKg, 0);
    const grandGross = productRows.reduce((s, p) => s + p.grossKg, 0);
    body3.push([
      'TOTAL', fmtV(grandVol),
      fmtN(grandNet),
      fmtN(grandGross),
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

  if (ctx.stampUrl) {
    try {
      const lastPage = (doc as any).lastAutoTable?.finalY || 200;
      const stampSize = 35;
      const stampX = 196 - stampSize;
      const stampY = Math.min(lastPage + 5, 255);
      let fmt = 'PNG';
      const m = ctx.stampUrl.match(/^data:image\/(\w+);/i);
      if (m) { fmt = m[1].toUpperCase(); if (fmt === 'JPG') fmt = 'JPEG'; }
      doc.addImage(ctx.stampUrl, fmt, stampX, stampY, stampSize, stampSize);
    } catch (e) { console.warn('[PL PDF] Could not add stamp:', e); }
  }

  if (autoDownload) {
    doc.save(`PackingList_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  return doc;
}
