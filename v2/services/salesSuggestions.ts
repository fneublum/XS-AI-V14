// Sales-agent suggestion engine.
//
// Computes per-customer reorder candidates from raw `sales_orders`
// history. Pure transformation: callers fetch rows however they like
// (typically via `useSalesSuggestions`) and pass them through here.
//
// The output is ranked by "overdue factor" — how many of the customer's
// own typical re-order cycles have elapsed since their last purchase.
// Customers with only one order skip the overdue logic (no cadence to
// compare against) but still surface as "single order" suggestions when
// they're meaningfully old.

export interface RawOrder {
  id: string;
  orderDate: string | null;
  customerId: string | null;
  customerName: string | null;
  totalAmount: number | string | null;
  items: unknown;
  status: string | null;
}

export interface SalesSuggestion {
  customerId: string | null;
  customerName: string;
  orderCount: number;
  totalSpent: number;
  daysSinceLast: number;
  medianGapDays: number | null;
  overdueFactor: number | null;       // null when cadence can't be computed
  /** Top products by occurrence count, in descending order. */
  topProducts: Array<{
    name: string;
    occurrences: number;
    /** Average quantity per occurrence (rounded to nearest int). */
    avgQuantity: number;
  }>;
  /** Coarse bucket used for sort + badge: ordered by urgency. */
  bucket: 'urgent' | 'overdue' | 'due-soon' | 'recent' | 'single-order';
  reason: string;
}

const PRODUCT_NAME_RE = /^\s*(.+?)\s*$/;

function getItems(row: RawOrder): Array<Record<string, unknown>> {
  let raw: unknown = row.items;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function dayDiff(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildSalesSuggestions(rows: RawOrder[]): SalesSuggestion[] {
  const byCustomer = new Map<string, {
    customerId: string | null;
    customerName: string;
    orders: RawOrder[];
  }>();
  for (const r of rows) {
    if (r.status === 'CANCELLED') continue;
    const name = (r.customerName ?? '').trim();
    if (!name) continue;
    const key = name.toUpperCase();
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { customerId: r.customerId, customerName: name, orders: [] });
    }
    byCustomer.get(key)!.orders.push(r);
  }

  const now = new Date().toISOString().slice(0, 10);
  const out: SalesSuggestion[] = [];

  for (const { customerId, customerName, orders } of byCustomer.values()) {
    // Sort orders by date ascending. Rows missing a date are kept but
    // not used for cadence computation.
    const dated = orders.filter(o => o.orderDate).map(o => ({ ...o, _d: o.orderDate!.slice(0, 10) }));
    dated.sort((a, b) => a._d.localeCompare(b._d));

    const orderCount = orders.length;
    const totalSpent = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

    // Product aggregation
    const productAgg = new Map<string, { count: number; qtyTotal: number }>();
    for (const o of orders) {
      for (const it of getItems(o)) {
        const rawName = String(it.productName ?? it.name ?? '').trim();
        if (!rawName) continue;
        const m = rawName.match(PRODUCT_NAME_RE);
        const name = (m?.[1] ?? rawName).slice(0, 80);
        const qty = Number(it.quantity) || 0;
        if (!productAgg.has(name)) productAgg.set(name, { count: 0, qtyTotal: 0 });
        const agg = productAgg.get(name)!;
        agg.count++;
        agg.qtyTotal += qty;
      }
    }
    const topProducts = Array.from(productAgg.entries())
      .map(([name, v]) => ({
        name,
        occurrences: v.count,
        avgQuantity: v.count > 0 ? Math.round(v.qtyTotal / v.count) : 0,
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 3);

    // Cadence
    let medianGapDays: number | null = null;
    if (dated.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < dated.length; i++) {
        gaps.push(dayDiff(dated[i]._d, dated[i - 1]._d));
      }
      medianGapDays = median(gaps);
    }

    const lastDate = dated.length > 0 ? dated[dated.length - 1]._d : null;
    const daysSinceLast = lastDate ? dayDiff(now, lastDate) : 0;

    let overdueFactor: number | null = null;
    let bucket: SalesSuggestion['bucket'] = 'recent';
    let reason = '';

    if (medianGapDays && medianGapDays > 0) {
      overdueFactor = daysSinceLast / medianGapDays;
      if (overdueFactor >= 3) {
        bucket = 'urgent';
        reason = `${daysSinceLast}d since last order · ${overdueFactor.toFixed(1)}× their median cadence (~${Math.round(medianGapDays)}d)`;
      } else if (overdueFactor >= 1.5) {
        bucket = 'overdue';
        reason = `${daysSinceLast}d since last order · ${overdueFactor.toFixed(1)}× their median cadence (~${Math.round(medianGapDays)}d)`;
      } else if (overdueFactor >= 0.9) {
        bucket = 'due-soon';
        reason = `Approaching their usual ~${Math.round(medianGapDays)}d cycle (${daysSinceLast}d in)`;
      } else {
        bucket = 'recent';
        reason = `Ordered ${daysSinceLast}d ago · still within their ~${Math.round(medianGapDays)}d cycle`;
      }
    } else if (orderCount === 1) {
      bucket = 'single-order';
      if (daysSinceLast >= 60) {
        reason = `Single order ${daysSinceLast}d ago — no cadence yet, worth a follow-up`;
      } else {
        reason = `Single order ${daysSinceLast}d ago — too early to gauge cadence`;
      }
    } else {
      reason = `${orderCount} orders, no cadence available`;
    }

    out.push({
      customerId,
      customerName,
      orderCount,
      totalSpent,
      daysSinceLast,
      medianGapDays,
      overdueFactor,
      topProducts,
      bucket,
      reason,
    });
  }

  // Sort: urgent → overdue → due-soon → single-order(old) → recent.
  // Within a bucket, higher overdueFactor wins; ties broken by total spent.
  const rank: Record<SalesSuggestion['bucket'], number> = {
    'urgent': 0, 'overdue': 1, 'due-soon': 2, 'single-order': 3, 'recent': 4,
  };
  out.sort((a, b) => {
    if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket];
    const of = (b.overdueFactor ?? 0) - (a.overdueFactor ?? 0);
    if (of !== 0) return of;
    return b.totalSpent - a.totalSpent;
  });

  return out;
}

/** Pre-cook an intent string for the proposal composer based on the
 *  customer's purchase history. Stays concise — Gemini fills in tone. */
export function buildIntentForSuggestion(s: SalesSuggestion): string {
  const lines: string[] = [];
  if (s.bucket === 'urgent' || s.bucket === 'overdue') {
    lines.push(`Follow-up reorder for ${s.customerName}. They typically order every ~${Math.round(s.medianGapDays ?? 30)} days; it's been ${s.daysSinceLast} days since their last order — let's check in and offer a reorder.`);
  } else if (s.bucket === 'due-soon') {
    lines.push(`Proactive reorder check-in for ${s.customerName}. They're approaching their usual ~${Math.round(s.medianGapDays ?? 30)}-day cycle (${s.daysSinceLast} days in). Confirm current need and offer pricing on their usual items.`);
  } else if (s.bucket === 'single-order') {
    lines.push(`Re-engagement for ${s.customerName}. They placed one order ${s.daysSinceLast} days ago and haven't ordered since. Check satisfaction and ask about upcoming needs.`);
  } else {
    lines.push(`Account check-in for ${s.customerName}.`);
  }

  if (s.topProducts.length > 0) {
    lines.push('');
    lines.push('They previously bought:');
    for (const p of s.topProducts) {
      lines.push(`• ${p.name} (×${p.occurrences}${p.avgQuantity ? `, avg qty ${p.avgQuantity}` : ''})`);
    }
  }
  lines.push('');
  lines.push(`Lifetime value with us: $${Math.round(s.totalSpent).toLocaleString('en-US')} across ${s.orderCount} order${s.orderCount === 1 ? '' : 's'}.`);
  return lines.join('\n');
}
