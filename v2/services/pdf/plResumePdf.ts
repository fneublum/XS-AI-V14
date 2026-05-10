// Packing-list "Resume per Product" and "Resume per Container" PDFs.
// Ported from v1 PLInvoiceEngine.tsx::exportProductPDF / exportContainerPDF
// (pages/PLInvoiceEngine.tsx:918 and :1022). Feeds directly off the v2
// PLDraft so the same buttons in the v2 engine produce the same layout.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PLContainer, PLDraft } from '../../routes/packingListShared';

const fmt2 = (n: number | null | undefined): string => {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtCount = (n: number | null | undefined): string => {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return v.toLocaleString();
};

/** Prefer the linked system product (catalog match) over the free-text
 *  description when present — matches v1's getSystemDesc priority. */
const describeForProduct = (c: PLContainer): string =>
  (c.systemProduct && c.systemProduct.trim())
    ? c.systemProduct.trim()
    : (c.description && c.description.trim()) || '';

const totalsOf = (containers: PLContainer[]) =>
  containers.reduce((acc, c) => ({
    grossLbs: acc.grossLbs + (c.grossLbs ?? 0),
    netLbs:   acc.netLbs   + (c.netLbs   ?? 0),
    grossKg:  acc.grossKg  + (c.grossKg  ?? 0),
    netKg:    acc.netKg    + (c.netKg    ?? 0),
    volumes:  acc.volumes  + (c.volumes  ?? 0),
  }), { grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 });

export function generatePLPerProductPdf(draft: PLDraft): { doc: jsPDF; fileName: string } {
  const doc = new jsPDF('l', 'mm', 'a4');
  const plLabel = draft.plNumber || 'Draft';
  doc.setFontSize(14);
  doc.text(`Resume per Product - PL: ${plLabel}`, 14, 15);

  const containers = draft.containers ?? [];
  const totals = totalsOf(containers);

  // Detail rows — one per container/line.
  const detailBody = containers.map(c => [
    describeForProduct(c),
    c.containerNo || '',
    c.sealNo || '',
    fmt2(c.grossLbs),
    fmt2(c.netLbs),
    fmt2(c.grossKg),
    fmt2(c.netKg),
    fmtCount(c.volumes),
    c.blNumber || '',
  ]);
  detailBody.push([
    'TOTALS', '', '',
    fmt2(totals.grossLbs), fmt2(totals.netLbs),
    fmt2(totals.grossKg), fmt2(totals.netKg),
    fmtCount(totals.volumes), '',
  ]);

  autoTable(doc, {
    head: [['Product Desc (System)', 'Container No.', 'Seal No.',
      'Gross (lbs)', 'Net (lbs)', 'Gross (kg)', 'Net (kg)', 'Volumes', 'BL#']],
    body: detailBody,
    startY: 25,
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  // Summary — aggregate by system description.
  const productSummary: Record<string, { grossLbs: number; netLbs: number; grossKg: number; netKg: number; volumes: number }> = {};
  containers.forEach(c => {
    const key = describeForProduct(c) || 'Unassigned';
    if (!productSummary[key]) {
      productSummary[key] = { grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 };
    }
    productSummary[key].grossLbs += c.grossLbs ?? 0;
    productSummary[key].netLbs   += c.netLbs   ?? 0;
    productSummary[key].grossKg  += c.grossKg  ?? 0;
    productSummary[key].netKg    += c.netKg    ?? 0;
    productSummary[key].volumes  += c.volumes  ?? 0;
  });
  const summaryBody = Object.entries(productSummary).map(([desc, v]) => [
    desc, fmt2(v.grossLbs), fmt2(v.netLbs), fmt2(v.grossKg), fmt2(v.netKg), fmtCount(v.volumes),
  ]);
  summaryBody.push([
    'TOTALS',
    fmt2(totals.grossLbs), fmt2(totals.netLbs),
    fmt2(totals.grossKg), fmt2(totals.netKg),
    fmtCount(totals.volumes),
  ]);

  const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 80;
  doc.setFontSize(12);
  doc.text('Summary per Product (System Description)', 14, lastY + 10);
  autoTable(doc, {
    head: [['System Description', 'Gross (lbs)', 'Net (lbs)', 'Gross (kg)', 'Net (kg)', 'Volumes']],
    body: summaryBody,
    startY: lastY + 15,
    theme: 'grid',
    headStyles: { fillColor: [142, 68, 173], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });

  return { doc, fileName: `Resume_Product_${plLabel}.pdf` };
}

export function generatePLPerContainerPdf(draft: PLDraft): { doc: jsPDF; fileName: string } {
  const doc = new jsPDF('l', 'mm', 'a4');
  const plLabel = draft.plNumber || 'Draft';
  doc.setFontSize(14);
  doc.text(`Resume per Container - PL: ${plLabel}`, 14, 15);

  const containers = draft.containers ?? [];

  // Aggregate by containerNo — multiple products in one container get
  // summed into a single row. Matches v1's `containerSummary` build.
  type Agg = { containerNo: string; sealNo: string; grossLbs: number; netLbs: number; grossKg: number; netKg: number; volumes: number };
  const byContainer = new Map<string, Agg>();
  containers.forEach(c => {
    const key = (c.containerNo || '').trim() || '—';
    const existing = byContainer.get(key);
    if (existing) {
      existing.grossLbs += c.grossLbs ?? 0;
      existing.netLbs   += c.netLbs   ?? 0;
      existing.grossKg  += c.grossKg  ?? 0;
      existing.netKg    += c.netKg    ?? 0;
      existing.volumes  += c.volumes  ?? 0;
      if (!existing.sealNo && c.sealNo) existing.sealNo = c.sealNo;
    } else {
      byContainer.set(key, {
        containerNo: key,
        sealNo: c.sealNo || '',
        grossLbs: c.grossLbs ?? 0,
        netLbs:   c.netLbs   ?? 0,
        grossKg:  c.grossKg  ?? 0,
        netKg:    c.netKg    ?? 0,
        volumes:  c.volumes  ?? 0,
      });
    }
  });
  const totals = totalsOf(containers);

  const body = Array.from(byContainer.values()).map(c => [
    c.containerNo,
    c.sealNo,
    fmt2(c.grossLbs), fmt2(c.netLbs),
    fmt2(c.grossKg), fmt2(c.netKg),
    fmtCount(c.volumes),
  ]);
  body.push([
    'TOTALS', '',
    fmt2(totals.grossLbs), fmt2(totals.netLbs),
    fmt2(totals.grossKg), fmt2(totals.netKg),
    fmtCount(totals.volumes),
  ]);

  autoTable(doc, {
    head: [['Container No.', 'Seal No.', 'Gross (lbs)', 'Net (lbs)', 'Gross (kg)', 'Net (kg)', 'Volumes']],
    body,
    startY: 25,
    theme: 'grid',
    headStyles: { fillColor: [46, 204, 113], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  return { doc, fileName: `Resume_Container_${plLabel}.pdf` };
}
