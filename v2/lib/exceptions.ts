// Exception detection rules for the AI Dashboard "Exceptions" panel.
//
// Each rule is a pure function: (raw rows) → Exception[]. Adding a rule
// is a matter of writing one detector and adding it to runDetectors().

import type { AgentOrderRow } from '../queries/useAgentSalesOrders';

export type ExceptionSeverity = 'high' | 'medium' | 'low';

export type ExceptionRule =
  | 'commission_math'
  | 'duplicate_invoice'
  | 'zero_qty_invoiced';

export interface Exception {
  id: string;
  rule: ExceptionRule;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  entityType: 'order' | 'invoice';
  entityRef: string;
}

export interface RawCustomerInvoice {
  id: string;
  invoiceNumber: string | null;
  soNumber: string | null;
}

export const RULE_LABEL: Record<ExceptionRule, string> = {
  commission_math:    'Commission math mismatch',
  duplicate_invoice:  'Duplicate customer invoice',
  zero_qty_invoiced:  'Invoiced order with zero quantity',
};

export const SEVERITY_TONE: Record<ExceptionSeverity, string> = {
  high:   'bg-rose-500',
  medium: 'bg-amber-500',
  low:    'bg-slate-500',
};

const MONEY_TOLERANCE = 1; // dollars — ignore rounding noise

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** What the commission *should* be given the row's stored type/rate/qty.
 *  Mirrors the user expectation: PER_KGS / PER_LBS = qty × rate (no
 *  unit conversion); PERCENT = orderTotal × rate / 100. */
export function computeExpectedCommission(o: AgentOrderRow): number {
  const rate = o.commissionRate ?? 0;
  if (!rate) return 0;
  if (o.commissionType === 'PERCENT') return (o.orderTotal ?? 0) * rate / 100;
  if (o.commissionType === 'PER_LBS' || o.commissionType === 'PER_KGS') {
    return (o.totalQuantity ?? 0) * rate;
  }
  return 0;
}

function detectCommissionMath(orders: AgentOrderRow[]): Exception[] {
  const out: Exception[] = [];
  for (const o of orders) {
    if (!o.commissionRate || o.commissionRate === 0) continue;
    const expected = computeExpectedCommission(o);
    const stored = o.commissionAmount ?? 0;
    if (Math.abs(stored - expected) <= MONEY_TOLERANCE) continue;
    out.push({
      id: `commmath-${o.id}`,
      rule: 'commission_math',
      severity: 'high',
      title: RULE_LABEL.commission_math,
      detail: `${o.orderNumber} — stored ${fmtMoney(stored)}, expected ${fmtMoney(expected)} (${o.commissionType ?? '—'} × ${o.commissionRate})`,
      entityType: 'order',
      entityRef: o.orderNumber,
    });
  }
  return out;
}

function detectDuplicateInvoices(invoices: RawCustomerInvoice[]): Exception[] {
  const groups = new Map<string, RawCustomerInvoice[]>();
  for (const inv of invoices) {
    const key = inv.invoiceNumber?.trim();
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(inv);
    groups.set(key, arr);
  }
  const out: Exception[] = [];
  for (const [invoiceNumber, arr] of groups) {
    if (arr.length <= 1) continue;
    out.push({
      id: `dupinv-${invoiceNumber}`,
      rule: 'duplicate_invoice',
      severity: 'high',
      title: RULE_LABEL.duplicate_invoice,
      detail: `${invoiceNumber} — ${arr.length} rows in commission_customer_invoices${arr[0].soNumber ? ` (SO ${arr[0].soNumber})` : ''}`,
      entityType: 'invoice',
      entityRef: invoiceNumber,
    });
  }
  return out;
}

function detectZeroQtyInvoiced(orders: AgentOrderRow[]): Exception[] {
  const out: Exception[] = [];
  for (const o of orders) {
    if (o.stage !== 'INVOICED') continue;
    if ((o.totalQuantity ?? 0) > 0) continue;
    out.push({
      id: `zeroqty-${o.id}`,
      rule: 'zero_qty_invoiced',
      severity: 'medium',
      title: RULE_LABEL.zero_qty_invoiced,
      detail: `${o.orderNumber} — stage=Invoiced, totalQuantity=0`,
      entityType: 'order',
      entityRef: o.orderNumber,
    });
  }
  return out;
}

export function runDetectors(args: {
  orders: AgentOrderRow[];
  invoices: RawCustomerInvoice[];
}): Exception[] {
  return [
    ...detectCommissionMath(args.orders),
    ...detectDuplicateInvoices(args.invoices),
    ...detectZeroQtyInvoiced(args.orders),
  ];
}
