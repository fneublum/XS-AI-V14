// Shared customer-invoice extraction spec — used by both the
// AgentOrderWorkflowDrawer (add invoice to an existing order) and the
// list-level "OCR new invoice" entry on AgentSalesOrdersV2.

export interface CustomerInvoiceDraft {
  invoiceNumber: string;
  invoiceDate: string;
  sellerName: string;
  customerName: string;
  incoterm: string;
  paymentTerms: string;
  pol: string;
  pod: string;
  bookingNumber: string;
  items: Array<{
    description: string;
    /** Priced quantity — must satisfy quantity × unitPrice ≈ total.
     *  For cotton-style invoices this is the NET WEIGHT in Lbs. */
    quantity: number;
    /** Unit that `quantity` is in — Lbs / Kgs typically. */
    unit: string;
    unitPrice: number;
    total: number;
    grossLbs?: number;
    netLbs?: number;
    grossKg?: number;
    netKg?: number;
    /** Container / package count — separate from `quantity`. */
    volumeCount?: number;
    /** Container unit — "Bales" / "Bags" / "Pcs" / "Sets". */
    volumeUnit?: string;
  }>;
  originalDocument: string | null;
}

export const CUSTOMER_INV_PROMPT = `Extract fields from a COMMERCIAL INVOICE (seller to customer).
Return JSON with these keys exactly — null for missing values.

LINE ITEMS — for each line capture:

  • The PRICED quantity — the number that, multiplied by unitPrice,
    yields the total. On cotton / textile invoices this is the
    NET WEIGHT in pounds (Lbs). On pellet / resin invoices it is
    usually the net weight in lbs or kg. The pair (quantity, unit)
    must satisfy: quantity × unitPrice ≈ total.

  • The CONTAINER / package count — bales, bags, pieces, sets — in
    a SEPARATE pair (volumeCount, volumeUnit). Never put the bale
    count in "quantity" if the price is per pound.

  • Net + gross weights in Lbs and Kgs.

Where to find weights on cotton / textile invoices specifically:
- A "Weight" or "Net Weight" column on the same row as the description.
- A separate weight-summary block usually printed at the foot of the
  invoice with three labelled lines: "Gross", "Tare", "Net" (or
  "Peso Bruto / Tara / Peso Líquido"). Treat the "Net" figure as the
  net weight, the "Gross" figure as the gross weight, and assign
  them to the single line item if there is only one item on the
  invoice. The numbers may be formatted with commas or periods as
  the thousands / decimal separator — preserve the actual numeric
  value. Always assume these summary weights are in POUNDS unless
  the document explicitly says "kg", "kgs", "kilograms", or
  "quilos".
- A "Totals" row that repeats the bale count and weight together.

If only Lbs is given, leave Kg null — the system will convert. If
only Kg is given, leave Lbs null. Never guess.

{
  "invoiceNumber": string | null,
  "invoiceDate":   string | null,
  "sellerName":    string | null,
  "customerName":  string | null,
  "incoterm":      "FOB"|"CFR"|"CIF"|"EXW"|"DAP"|"DDP" | null,
  "paymentTerms":  string | null,
  "pol":           string | null,
  "pod":           string | null,
  "bookingNumber": string | null,
  "items": [{
    "description":  string,
    "quantity":     number|null,    // priced units (e.g. net Lbs)
    "unit":         string|null,    // "Lbs"|"Kgs"
    "unitPrice":    number|null,
    "total":        number|null,
    "grossLbs":     number|null,
    "netLbs":       number|null,
    "grossKg":      number|null,
    "netKg":        number|null,
    "volumeCount":  number|null,    // e.g. 600 bales
    "volumeUnit":   string|null     // "Bales"|"Bags"|"Pcs"|"Sets"
  }]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

const LBS_PER_KG = 2.20462;
const numOrUndef = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function normalizeCustomerInvoice(parsed: Record<string, unknown>): CustomerInvoiceDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const rawItems = Array.isArray(parsed.items) ? parsed.items as any[] : [];
  return {
    invoiceNumber: str('invoiceNumber'),
    invoiceDate:   str('invoiceDate'),
    sellerName:    str('sellerName'),
    customerName:  str('customerName'),
    incoterm:      str('incoterm').toUpperCase(),
    paymentTerms:  str('paymentTerms'),
    pol:           str('pol'),
    pod:           str('pod'),
    bookingNumber: str('bookingNumber'),
    originalDocument: null,
    items: rawItems.map(it => {
      const grossLbs = numOrUndef(it?.grossLbs);
      const netLbs   = numOrUndef(it?.netLbs);
      const grossKg  = numOrUndef(it?.grossKg);
      const netKg    = numOrUndef(it?.netKg);
      const total    = Number(it?.total) || 0;
      const unitPrice = Number(it?.unitPrice) || 0;
      let quantity = Number(it?.quantity) || 0;
      let unit     = String(it?.unit ?? 'Lbs');
      let volumeCount = numOrUndef(it?.volumeCount);
      let volumeUnit  = typeof it?.volumeUnit === 'string' ? it.volumeUnit.trim() : '';

      // Self-correct legacy / sloppy OCR outputs where the bale count
      // landed in `quantity`. If qty * price diverges from total but
      // (netLbs or netKg) * price ≈ total, swap them.
      const matches = (a: number, b: number) =>
        Math.abs(a - b) <= Math.max(0.5, b * 0.01);
      if (unitPrice > 0 && total > 0
          && quantity > 0 && !matches(quantity * unitPrice, total)) {
        const netLbsCandidate = netLbs;
        const netKgCandidate  = netKg;
        if (netLbsCandidate && matches(netLbsCandidate * unitPrice, total)) {
          if (volumeCount === undefined) { volumeCount = quantity; volumeUnit = unit; }
          quantity = netLbsCandidate;
          unit = 'Lbs';
        } else if (netKgCandidate && matches(netKgCandidate * unitPrice, total)) {
          if (volumeCount === undefined) { volumeCount = quantity; volumeUnit = unit; }
          quantity = netKgCandidate;
          unit = 'Kgs';
        }
      }

      return {
        description: String(it?.description ?? ''),
        quantity,
        unit,
        unitPrice,
        total: total || (quantity * unitPrice),
        grossLbs:    grossLbs ?? (grossKg ? grossKg * LBS_PER_KG : undefined),
        netLbs:      netLbs   ?? (netKg   ? netKg   * LBS_PER_KG : undefined),
        grossKg:     grossKg  ?? (grossLbs ? grossLbs / LBS_PER_KG : undefined),
        netKg:       netKg    ?? (netLbs   ? netLbs   / LBS_PER_KG : undefined),
        volumeCount,
        volumeUnit:  volumeUnit || undefined,
      };
    }),
  };
}
