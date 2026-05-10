/**
 * AI Anomaly Detector — Price deviation detection for supplier invoices
 * 
 * Groups invoices by supplier + product, calculates historical averages,
 * and flags invoices where price deviates >15% from the mean.
 */

export interface AnomalyResult {
    invoiceId: string;
    deviationPercent: number;        // e.g., +22 or -18
    direction: 'above' | 'below';
    currentPrice: number;
    averagePrice: number;
    supplierName: string;
    productName: string;
    sampleSize: number;              // How many invoices in the comparison group
}

interface InvoiceForAnalysis {
    id: string;
    supplierName?: string;
    items?: string;
    totalAmount?: number | string;
    date?: string;
    invoiceDate?: string;
}

/**
 * Parse unit price from an invoice's items JSON
 */
const extractUnitPrice = (inv: InvoiceForAnalysis): { price: number; product: string } | null => {
    try {
        if (!inv.items) return null;
        const parsed = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
        if (!Array.isArray(parsed) || parsed.length === 0) return null;

        const item = parsed[0];
        const price = Number(item.unitPrice || item.pricePerUnit || item.rate || 0);
        const product = item.description || item.productName || item.product || item.name || 'Unknown';

        if (price <= 0) return null;
        return { price, product };
    } catch {
        return null;
    }
};

/**
 * Detect price anomalies across a set of supplier invoices.
 * Returns a Map of invoiceId → AnomalyResult for flagged invoices.
 */
export const detectAnomalies = (invoices: InvoiceForAnalysis[], threshold = 0.15): Map<string, AnomalyResult> => {
    const results = new Map<string, AnomalyResult>();

    // Build groups: supplier + product → price history
    const groups = new Map<string, { prices: number[]; invoiceIds: string[]; supplierName: string; productName: string }>();

    for (const inv of invoices) {
        const supplier = (inv.supplierName || '').trim().toUpperCase();
        if (!supplier) continue;

        const extracted = extractUnitPrice(inv);
        if (!extracted) continue;

        const product = extracted.product.trim().toUpperCase().substring(0, 40); // Normalize
        const key = `${supplier}|||${product}`;

        if (!groups.has(key)) {
            groups.set(key, { prices: [], invoiceIds: [], supplierName: supplier, productName: extracted.product });
        }

        const group = groups.get(key)!;
        group.prices.push(extracted.price);
        group.invoiceIds.push(inv.id);
    }

    // Analyze each group
    for (const [, group] of groups) {
        if (group.prices.length < 3) continue; // Need at least 3 data points

        const avg = group.prices.reduce((a, b) => a + b, 0) / group.prices.length;
        if (avg <= 0) continue;

        // Check each invoice in the group
        for (let i = 0; i < group.prices.length; i++) {
            const price = group.prices[i];
            const deviation = (price - avg) / avg;

            if (Math.abs(deviation) >= threshold) {
                results.set(group.invoiceIds[i], {
                    invoiceId: group.invoiceIds[i],
                    deviationPercent: Math.round(deviation * 100),
                    direction: deviation > 0 ? 'above' : 'below',
                    currentPrice: price,
                    averagePrice: avg,
                    supplierName: group.supplierName,
                    productName: group.productName,
                    sampleSize: group.prices.length
                });
            }
        }
    }

    return results;
};
