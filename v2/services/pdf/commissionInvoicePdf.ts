// Agent-to-supplier commission invoice PDF.
//
// We (the agent) invoice the SUPPLIER for the commission we earned on
// a closed order. This is NOT the customer-facing commercial invoice
// — it's the document that moves money from supplier to agent.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PdfCompany } from './types';
import type { AgentOrderRow } from '../../queries/useAgentSalesOrders';
import { calcCommissionAmount } from '../../lib/agentPipelineStage';

export interface CommissionInvoiceInputs {
  order: AgentOrderRow;
  invoiceNumber: string;
  invoiceDate: string;
  agentCompany?: PdfCompany;
  notes?: string | null;
}

const BRAND = '#F57F25';
const INK = '#1f2937';
const MUTED = '#6b7280';

function unitLabel(type: string | null | undefined): string {
  if (type === 'PER_LBS')  return '$/Lbs';
  if (type === 'PER_KGS')  return '$/Kgs';
  if (type === 'PERCENT')  return '%';
  return '—';
}

export function generateCommissionInvoicePdf(input: CommissionInvoiceInputs): jsPDF {
  const { order, invoiceNumber, invoiceDate, agentCompany, notes } = input;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Header — agent block (left), invoice block (right).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BRAND);
  doc.text(agentCompany?.name ?? 'Sales Agent', margin, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const agentLines = [
    agentCompany?.address,
    [agentCompany?.city, agentCompany?.state, agentCompany?.zip].filter(Boolean).join(', '),
    agentCompany?.country,
    agentCompany?.phone,
  ].filter(Boolean) as string[];
  agentLines.forEach((line, i) => {
    doc.text(line, margin, 26 + i * 4);
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(INK);
  doc.text('COMMISSION INVOICE', pageW - margin, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(`No.  ${invoiceNumber}`, pageW - margin, 27, { align: 'right' });
  doc.text(`Date ${invoiceDate}`, pageW - margin, 32, { align: 'right' });

  doc.setDrawColor(BRAND);
  doc.setLineWidth(0.6);
  doc.line(margin, 48, pageW - margin, 48);

  // "Bill to" block — the supplier.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('BILL TO', margin, 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(order.sellerName ?? '—', margin, 62);

  // Reference block (right).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('REFERENCE', pageW - margin - 70, 56);
  doc.setFont('helvetica', 'normal');
  doc.text(`Order  ${order.orderNumber}`,       pageW - margin - 70, 62);
  doc.text(`Customer  ${order.customerName}`,   pageW - margin - 70, 67);
  if (order.invoiceNumber) {
    doc.text(`CI  ${order.invoiceNumber}`,      pageW - margin - 70, 72);
  }

  // Line items table — one row per product on the sale.
  const rate = order.commissionRate ?? 0;
  const type = order.commissionType ?? 'PERCENT';
  const amount = calcCommissionAmount(type, rate, order.orderTotal, order.totalQuantity);

  const headers = [['Description', 'Order value', 'Rate', 'Commission']];
  const body = [
    [
      `Commission on ${order.orderNumber} — ${order.customerName}`,
      order.orderTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
      `${rate} ${unitLabel(type)}`,
      amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
    ],
  ];

  autoTable(doc, {
    startY: 85,
    margin: { left: margin, right: margin },
    head: headers,
    body,
    headStyles: { fillColor: BRAND, textColor: '#ffffff', fontSize: 10 },
    bodyStyles: { fontSize: 10, textColor: INK },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
  });

  // @ts-expect-error injected by jspdf-autotable
  let y: number = doc.lastAutoTable?.finalY ?? 100;
  y += 6;

  // Totals block.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(
    `Total due: ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
    pageW - margin, y, { align: 'right' },
  );
  y += 12;

  // Notes / payment instructions.
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
  doc.text(
    'Please remit payment per the agreed terms. Reference the invoice number above.',
    margin, y,
  );

  return doc;
}

/** Serialize the doc to a Blob suitable for Supabase storage upload. */
export function pdfToBlob(doc: jsPDF): Blob {
  return doc.output('blob');
}
