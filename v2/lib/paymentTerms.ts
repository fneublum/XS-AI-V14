// Payment-terms parsing — turn a human string like "Net 30 Days" or
// "30% Advance + 70% Cash Against Documents" into a number of days
// from the invoice date.
//
// Why this needed its own module: the previous in-place helper
// (`parseInt(terms.match(/\d+/), 10)`) grabbed the FIRST number, which
// for percentage-based terms like "30% Advance + 70% CAD" returned 30
// (read as days), giving an invoice issued 27May26 a due date of
// 26Jun26 — completely fake. Real merchants use a mix of duration
// terms ("Net 30 Days"), letter-of-credit terms ("L/C 60 Days"),
// and immediate terms ("Cash Against Documents", "Prepaid", "L/C at
// Sight") that don't follow a Net-N pattern at all.
//
// Strategy:
//   1. Strip percentages (`\d+%`) — they're amount-of-invoice splits,
//      never durations.
//   2. Test for "immediate" keywords (Prepaid / CAD / Sight / COD)
//      → 0 days.
//   3. Look for "<N> Days" / "Net <N>" / "T/T <N>" / "L/C <N>" —
//      the canonical duration patterns.
//   4. Fall back to 0 (assume due immediately) when nothing matches.
//      That's more conservative than the old "default 30 days" which
//      could push payables past real due dates.

// Default days-to-settle for trade-finance / shipping terms that don't
// embed an explicit duration. These are conventional ocean-freight
// rules of thumb, not bank-mandated rules — adjust as your business
// pattern reveals different averages.
const KEYWORD_DEFAULTS: Array<{ match: RegExp; days: number }> = [
    // ── Immediate (paid by, or before, invoice date) ────────────
    { match: /\bprepaid\b/,                       days: 0  },
    { match: /\bcash on delivery\b/,              days: 0  },
    { match: /\bcod\b/,                           days: 0  },
    { match: /\bon delivery\b/,                   days: 0  },
    { match: /\bin advance\b/,                    days: 0  },
    // ── Trade-finance defaults (no explicit days in the term) ───
    // CAD = Cash Against Documents. Realistic average: ~30 days
    // between shipment and document arrival at the destination
    // bank, when the buyer's bank releases payment. Override by
    // writing the term as "CAD 45 Days" if your route is longer.
    { match: /\bcash against documents\b|\bcad\b/, days: 30 },
    // L/C at Sight: bank processes the draw on document presentation
    // — typically 7-14 days end-to-end. Pick the middle of the range.
    { match: /\bl\/c at sight\b|\blc at sight\b|\bat sight\b/, days: 14 },
];

/** Returns the number of days to add to the invoice date, given a
 *  free-text payment-terms string.
 *
 *  Precedence:
 *    1. Explicit duration patterns ("Net 30", "T/T 30", "L/C 60",
 *       "30 days") — always win when present.
 *    2. Trade-finance keyword defaults (CAD, L/C at Sight) — pick a
 *       realistic average when no number is given.
 *    3. Immediate-pay keywords (Prepaid, COD, In Advance) → 0 days.
 *    4. Anything else → 0 (conservative; better to flag as due now
 *       than to project payments far in the future).
 *
 *  Percentage tokens are stripped first so "30% Advance + 70% CAD"
 *  resolves via the CAD rule (→ 30 days), not via the bare "30" or
 *  the "in advance" sub-string.
 */
export function parseTermsDays(terms: string | null | undefined): number {
    if (!terms) return 0;
    // Strip percentage tokens so they don't confuse the matchers below.
    //   "30% Advance + 70% CAD" → " Advance +  CAD"
    const cleaned = terms.toLowerCase().replace(/\d+\s*%/g, ' ');

    // 1. Explicit duration always wins.
    const dur =
        cleaned.match(/\b(?:net|t\/t|tt|l\/c|lc)\s*(\d{1,4})\b/) ||
        cleaned.match(/\b(\d{1,4})\s*days?\b/);
    if (dur) {
        const n = parseInt(dur[1], 10);
        if (Number.isFinite(n) && n >= 0 && n <= 720) return n;
    }

    // 2 & 3. Keyword-based defaults. First match wins; the table is
    // ordered with the most-immediate at the top so "Cash on Delivery"
    // beats "Cash Against Documents" when both are present.
    for (const { match, days } of KEYWORD_DEFAULTS) {
        if (match.test(cleaned)) return days;
    }

    return 0;
}

/** Sugar — apply parseTermsDays to an invoice date. Returns null when
 *  the base date is missing/invalid so callers can render an em-dash. */
export function calcDueDate(
    invoiceDate: string | null | undefined,
    paymentTerms: string | null | undefined,
): Date | null {
    if (!invoiceDate) return null;
    const base = new Date(invoiceDate);
    if (isNaN(base.getTime())) return null;
    const days = parseTermsDays(paymentTerms);
    base.setUTCDate(base.getUTCDate() + days);
    return base;
}
