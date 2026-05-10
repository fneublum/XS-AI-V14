// Agent Sales Orders pipeline.
//
// 6 stages, status-driven. The master row's `status` column on
// commission_sales_orders is the single source of truth; the "has X"
// flags are only consulted as legacy fallback for rows that predate
// this vocabulary.
//
//   1. PROPOSAL           — supplier proposal captured (OCR or typed)
//   2. OFFER              — we drafted the offer TO the customer
//   3. PROFORMA           — customer accepted, proforma (sales contract) issued
//   4. INVOICED           — goods shipped, final commercial invoice OCR'd,
//                           commission calculated
//   5. UNPAID_COMMISSION  — customer paid the supplier; we've sent
//                           our commission invoice to the seller but
//                           haven't been paid yet
//   6. PAID_COMMISSION    — seller paid our commission (archive view)

export type PipelineStage =
  | 'PROPOSAL'
  | 'OFFER'
  | 'PROFORMA'
  | 'INVOICED'
  | 'UNPAID_COMMISSION'
  | 'PAID_COMMISSION';

export interface PipelineInputs {
  status: string;
  hasOffer: boolean;
  hasProforma: boolean;
  hasCustomerInvoice: boolean;
  paymentStatus: string | null;
  commissionPaymentStatus: string | null;
  hasCommissionInvoice: boolean;
}

/** The master row's `status` drives the stage, with one override:
 *  if `commissionPaymentStatus='PAID'` we trust that signal over a
 *  stale `status='INVOICED'` so paid commissions never get stuck on
 *  the Invoiced tab. Everything else is a fallback for rows written
 *  before this vocabulary existed. */
export function derivePipelineStage(i: PipelineInputs): PipelineStage {
  if ((i.commissionPaymentStatus ?? '').toUpperCase() === 'PAID') return 'PAID_COMMISSION';

  const s = (i.status ?? '').toUpperCase();
  if (s === 'PAID_COMMISSION')   return 'PAID_COMMISSION';
  if (s === 'UNPAID_COMMISSION') return 'UNPAID_COMMISSION';
  if (s === 'INVOICED')          return 'INVOICED';
  if (s === 'PROFORMA')          return 'PROFORMA';
  if (s === 'OFFER' || s === 'OFFER_SAVED' || s === 'OFFER_SENT'
      || s === 'OFFER_APPROVED' || s === 'OFFER_REJECTED') return 'OFFER';
  if (s === 'PROPOSAL' || s === 'PROPOSED' || s === 'PROPOSAL_OFFERED'
      || s === 'PROPOSAL_SENT' || s === 'PROPOSAL_REJECTED') return 'PROPOSAL';

  // Legacy fallback.
  if (i.hasCommissionInvoice)                                      return 'UNPAID_COMMISSION';
  if ((i.paymentStatus ?? '').toUpperCase() === 'PAID')            return 'UNPAID_COMMISSION';
  if (i.hasCustomerInvoice)                                        return 'INVOICED';
  if (i.hasProforma)                                               return 'PROFORMA';
  if (i.hasOffer)                                                  return 'OFFER';
  return 'PROPOSAL';
}

// User-facing labels. Internal stage IDs `PROPOSAL`/`OFFER` are
// historical; the UI now flips them — what we call PROPOSAL internally
// (the supplier-incoming, immutable record) is shown as "Offer", and
// what we call OFFER internally (our outgoing customer document) is
// shown as "Proposal". This keeps the database and types stable.
export const stageLabel: Record<PipelineStage, string> = {
  PROPOSAL:           'Offer',
  OFFER:              'Proposal',
  PROFORMA:           'Proforma',
  INVOICED:           'Invoiced',
  UNPAID_COMMISSION:  'Received',
  PAID_COMMISSION:    'Paid',
};

export const stageTone: Record<PipelineStage,
  'neutral' | 'info' | 'warning' | 'success'> = {
  PROPOSAL:           'neutral',
  OFFER:              'neutral',
  PROFORMA:           'warning',
  INVOICED:           'warning',
  UNPAID_COMMISSION:  'info',
  PAID_COMMISSION:    'success',
};

export const STAGE_ORDER: PipelineStage[] = [
  'PROPOSAL', 'OFFER', 'PROFORMA', 'INVOICED', 'UNPAID_COMMISSION', 'PAID_COMMISSION',
];

export type CommissionType = 'PERCENT' | 'PER_LBS' | 'PER_KGS';

export const commissionTypeLabel: Record<CommissionType, string> = {
  PERCENT: '% on sale',
  PER_LBS: '$/Lbs',
  PER_KGS: '$/Kgs',
};

// Lbs ↔ Kg conversion factor (1 lb = 0.453592 kg, 1 kg = 2.20462 lb).
const LBS_PER_KG = 2.20462;

/** Decide whether a row's quantity is stored in Kgs vs Lbs based on
 *  the (free-form) unit string. Falls back to Lbs for legacy data. */
function quantityIsKgs(unit: string | null | undefined): boolean {
  const u = (unit ?? '').trim().toLowerCase();
  return u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilos'
      || u === 'kilogram' || u === 'kilograms';
}

/** Compute the commission amount honoring the unit the quantity is
 *  expressed in. Earlier the function assumed quantity was always in
 *  pounds — wrong once OCR started writing Kgs. Now we normalize:
 *
 *   - PERCENT      → orderTotal × rate / 100 (unit-agnostic)
 *   - PER_LBS  rate → quantity converted to Lbs first
 *   - PER_KGS  rate → quantity converted to Kgs first
 */
export function calcCommissionAmount(
  type: CommissionType,
  rate: number,
  orderTotal: number,
  totalQuantity: number,
  qtyUnit?: string | null,
): number {
  if (!Number.isFinite(rate) || rate === 0) return 0;
  if (type === 'PERCENT') return orderTotal * rate / 100;

  const isKgs = quantityIsKgs(qtyUnit);
  const qtyLbs = isKgs ? totalQuantity * LBS_PER_KG : totalQuantity;
  const qtyKgs = isKgs ? totalQuantity : totalQuantity / LBS_PER_KG;

  if (type === 'PER_LBS') return qtyLbs * rate;
  if (type === 'PER_KGS') return qtyKgs * rate;
  return 0;
}
