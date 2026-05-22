// Pure aggregation helpers for the Agent Follow Up board.
//
// Takes the per-order rows from `useAgentSalesOrders` and produces:
//   * Per-agent rollups (counts, totals, outstanding, last activity).
//   * Outstanding commission rows (UNPAID, sorted by age).
//   * Headline KPIs for the top-of-page cards.

import type { AgentOrderRow } from '../queries/useAgentSalesOrders';

export interface AgentRollup {
  /** Normalised display name (canonical, dedupes case/whitespace variants). */
  agent: string;
  orderCount: number;
  totalOrderValue: number;
  totalCommission: number;
  /** Commission earned but not yet billed (orders at INVOICED stage
   *  without a commission-payment-status mark). Mirrors the
   *  "Commission to receive" tile from Agent Sales Orders. */
  invoicedCount: number;
  invoicedAmount: number;
  /** Commission billed to the agent, awaiting their payment. */
  unpaidCount: number;
  unpaidAmount: number;
  approvedCount: number;
  approvedAmount: number;
  paidCount: number;
  paidAmount: number;
  /** Most recent createdAt across this agent's orders. ISO YYYY-MM-DD or null. */
  lastActivity: string | null;
  /** Days since last activity, or null when unknown. */
  daysSinceActivity: number | null;
}

export interface OutstandingRow {
  id: string;
  orderNumber: string;
  agent: string;
  customerName: string;
  commissionAmount: number;
  commissionInvoiceNumber: string | null;
  commissionInvoiceDate: string | null;
  /** Days since the commission invoice was issued (or createdAt fallback). */
  ageDays: number;
  stage: string;
  /** Outstanding bucket aligned with the Agent Sales Orders KPIs:
   *  - INVOICED  → commission earned, no commission-invoice issued yet
   *  - UNPAID    → commission invoice sent to agent, awaiting payment
   *  - APPROVED  → agent confirmed, awaiting transfer
   *  PAID and HOLD rows are excluded from this list. */
  status: 'INVOICED' | 'UNPAID' | 'APPROVED';
  /** Storage URL of the issued commission invoice PDF, when present.
   *  Drives the "Email invoice" action: if the PDF exists the row can
   *  be emailed straight from this board; if not, the user is sent
   *  back to the pipeline to generate it. */
  commissionInvoicePdfUrl: string | null;
}

export interface AgentFollowUpSummary {
  agents: AgentRollup[];
  outstanding: OutstandingRow[];
  totals: {
    agents: number;
    activeOrders: number;
    ytdCommission: number;
    outstandingAmount: number;
    paidAmount: number;
    stalledCount: number;
  };
}

/** Collapse case / whitespace / punctuation variants of the same agent
 *  name. e.g. "FIBERTEX S.A. DE C.V." and "FIBERTEX, S.A de C.V." merge.
 *  Returns a normalised KEY for grouping; the rollup preserves the
 *  longest seen display variant for the UI. */
function normaliseAgent(name: string | null | undefined): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dayDiffFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

const STALLED_THRESHOLD_DAYS = 30;

export function buildAgentFollowUp(rows: AgentOrderRow[]): AgentFollowUpSummary {
  const byKey = new Map<string, {
    displayName: string;
    rollup: AgentRollup;
  }>();
  const outstanding: OutstandingRow[] = [];
  const thisYear = new Date().getFullYear();
  let activeOrders = 0;
  let ytdCommission = 0;
  let outstandingAmount = 0;
  let paidAmount = 0;
  let stalledCount = 0;

  for (const r of rows) {
    const key = normaliseAgent(r.sellerName);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        displayName: (r.sellerName ?? '').trim(),
        rollup: {
          agent: (r.sellerName ?? '').trim(),
          orderCount: 0,
          totalOrderValue: 0,
          totalCommission: 0,
          invoicedCount: 0,
          invoicedAmount: 0,
          unpaidCount: 0,
          unpaidAmount: 0,
          approvedCount: 0,
          approvedAmount: 0,
          paidCount: 0,
          paidAmount: 0,
          lastActivity: null,
          daysSinceActivity: null,
        },
      };
      byKey.set(key, entry);
    }
    // Prefer the longest display variant as the canonical label.
    const candidate = (r.sellerName ?? '').trim();
    if (candidate.length > entry.displayName.length) {
      entry.displayName = candidate;
      entry.rollup.agent = candidate;
    }

    const ru = entry.rollup;
    ru.orderCount += 1;
    ru.totalOrderValue += Number(r.orderTotal) || 0;
    const ca = Number(r.commissionAmount) || 0;
    ru.totalCommission += ca;

    // Stage-led classification mirrors the canonical "Commission to
    // receive" / "Commission received" buckets used by Agent Sales
    // Orders. Within an outstanding stage we sub-bucket by the
    // commissionPaymentStatus stamp the user puts on the row.
    const status = (r.commissionPaymentStatus ?? '').toUpperCase();
    if (r.stage === 'PAID_COMMISSION' || status === 'PAID') {
      ru.paidCount += 1;
      ru.paidAmount += ca;
    } else if (r.stage === 'UNPAID_COMMISSION') {
      if (status === 'APPROVED') {
        ru.approvedCount += 1;
        ru.approvedAmount += ca;
      } else {
        // No stamp yet = treat as UNPAID (the agent owes us).
        ru.unpaidCount += 1;
        ru.unpaidAmount += ca;
      }
    } else if (r.stage === 'INVOICED') {
      // Commission earned but no commission invoice issued yet.
      ru.invoicedCount += 1;
      ru.invoicedAmount += ca;
    }

    const orderIso = r.createdAt ?? null;
    if (orderIso && (!ru.lastActivity || orderIso > ru.lastActivity)) {
      ru.lastActivity = orderIso.slice(0, 10);
    }

    // Page-level totals (current year only for "YTD").
    const inYtd = orderIso ? new Date(orderIso).getFullYear() === thisYear : false;
    if (inYtd) ytdCommission += ca;

    if (r.stage !== 'PAID_COMMISSION') activeOrders += 1;
    if (r.stage === 'PAID_COMMISSION' || status === 'PAID') {
      paidAmount += ca;
    } else if (r.stage === 'INVOICED' || r.stage === 'UNPAID_COMMISSION') {
      outstandingAmount += ca;
    }

    // Outstanding rows: stage-led. Anything at INVOICED or
    // UNPAID_COMMISSION (unless explicitly stamped PAID) belongs here.
    const isOutstandingStage =
      r.stage === 'INVOICED' || r.stage === 'UNPAID_COMMISSION';
    if (isOutstandingStage && status !== 'PAID' && status !== 'HOLD') {
      const ageBase = r.commissionInvoiceDate ?? r.createdAt;
      const age = dayDiffFromIso(ageBase) ?? 0;
      if (age > STALLED_THRESHOLD_DAYS) stalledCount += 1;
      let rowStatus: OutstandingRow['status'];
      if (r.stage === 'INVOICED') rowStatus = 'INVOICED';
      else if (status === 'APPROVED') rowStatus = 'APPROVED';
      else rowStatus = 'UNPAID';
      outstanding.push({
        id: r.id,
        orderNumber: r.orderNumber,
        agent: candidate,
        customerName: r.customerName,
        commissionAmount: ca,
        commissionInvoiceNumber: r.commissionInvoiceNumber,
        commissionInvoiceDate: r.commissionInvoiceDate,
        ageDays: age,
        stage: r.stage,
        status: rowStatus,
        commissionInvoicePdfUrl: r.commissionInvoicePdfUrl,
      });
    }
  }

  // Finalise rollups: derive daysSinceActivity.
  const agents: AgentRollup[] = [];
  for (const { rollup } of byKey.values()) {
    rollup.daysSinceActivity = dayDiffFromIso(rollup.lastActivity);
    agents.push(rollup);
  }
  // Sort agents by outstanding amount desc (then total commission desc),
  // so the user sees who owes the most at the top.
  agents.sort((a, b) => {
    const aOut = a.invoicedAmount + a.unpaidAmount + a.approvedAmount;
    const bOut = b.invoicedAmount + b.unpaidAmount + b.approvedAmount;
    if (bOut !== aOut) return bOut - aOut;
    return b.totalCommission - a.totalCommission;
  });

  // Outstanding: oldest first — that's the payment-pressure order the
  // user wants for follow-up calls.
  outstanding.sort((a, b) => b.ageDays - a.ageDays);

  return {
    agents,
    outstanding,
    totals: {
      agents: agents.length,
      activeOrders,
      ytdCommission,
      outstandingAmount,
      paidAmount,
      stalledCount,
    },
  };
}
