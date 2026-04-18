// Phase 3B — BR-mode / 50% price adjusters.
//
// Ported from v1's handlePrepareEmailDraft (PLInvoiceEngine.tsx:1740).
// BR mode: customer-specific pricing for Brazilian imports (Beatriz =
//   fixed $0.28/kg, Patex/Patamute = 50% off) and invoice number
//   rewritten as `EC${last2}`.
// Half mode: flat 50% discount on unit prices for any customer.

import { PdfInvoice } from './types';

const parseItems = (raw: unknown): any[] => {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch { return []; }
};

const round4 = (n: number) => Number(n.toFixed(4));
const round2 = (n: number) => Number(n.toFixed(2));

const brInvoiceNumber = (orig: string | undefined): string => {
  const num = orig ?? '';
  const last2 = num.replace(/\D/g, '').slice(-2);
  return `EC${last2}`;
};

/** Apply BR-mode pricing. Returns a new invoice; does NOT mutate the
 *  original. Beatriz = $0.28/kg fixed. Patex/Patamute = 50% off. */
export function applyBrMode(inv: PdfInvoice): PdfInvoice {
  const customerName = (inv.billToName || inv.soldTo || '').toUpperCase();
  const items = parseItems(inv.items);

  const isBeatriz = customerName.includes('BEATRIZ');
  const isPatex = customerName.includes('PATEX') || customerName.includes('PATAMUTE');

  if (!isBeatriz && !isPatex) {
    // Still override invoice number in BR mode.
    return { ...inv, invoiceNumber: brInvoiceNumber(inv.invoiceNumber) };
  }

  const adjusted = items.map((item: any) => {
    const next = { ...item };
    if (isBeatriz) {
      next.unitPriceKg = 0.28;
      next.unitPriceLbs = round4(0.28 * 0.453592);
      next.unitPrice = next.unitPriceLbs;
    } else if (isPatex) {
      next.unitPrice = round4((item.unitPrice || 0) * 0.5);
      next.unitPriceLbs = round4((item.unitPriceLbs || item.unitPrice || 0) * 0.5);
      next.unitPriceKg = round4((item.unitPriceKg || 0) * 0.5);
    }
    next.amount = round2(
      (next.netLbs || next.quantity || 0) * (next.unitPriceLbs || next.unitPrice || 0),
    );
    return next;
  });

  const newSubtotal = adjusted.reduce((s: number, it: any) => s + (it.amount || 0), 0);

  return {
    ...inv,
    invoiceNumber: brInvoiceNumber(inv.invoiceNumber),
    items: JSON.stringify(adjusted),
    subtotal: newSubtotal,
    totalAmount: newSubtotal,
  } as PdfInvoice;
}

/** Apply a flat 50% discount to all unit prices + amounts. Used when
 *  the "50%" checkbox is on (independent of BR mode). */
export function applyHalfMode(inv: PdfInvoice): PdfInvoice {
  const items = parseItems(inv.items);
  const adjusted = items.map((item: any) => {
    const next = { ...item };
    next.unitPrice = round4((item.unitPrice || 0) * 0.5);
    next.unitPriceLbs = round4((item.unitPriceLbs || item.unitPrice || 0) * 0.5);
    next.unitPriceKg = round4((item.unitPriceKg || 0) * 0.5);
    next.amount = round2(
      (next.netLbs || next.quantity || 0) * (next.unitPriceLbs || next.unitPrice || 0),
    );
    return next;
  });

  const newSubtotal = adjusted.reduce((s: number, it: any) => s + (it.amount || 0), 0);

  return {
    ...inv,
    items: JSON.stringify(adjusted),
    subtotal: newSubtotal,
    totalAmount: newSubtotal,
  } as PdfInvoice;
}

/** Apply BR + 50% in order — BR first (customer-specific), then 50% if
 *  selected. This mirrors v1 where BR is the primary toggle and 50%
 *  stacks on top. */
export function applyAdjustments(
  inv: PdfInvoice,
  opts: { brMode: boolean; halfMode: boolean },
): PdfInvoice {
  let out = inv;
  if (opts.brMode)   out = applyBrMode(out);
  if (opts.halfMode) out = applyHalfMode(out);
  return out;
}
