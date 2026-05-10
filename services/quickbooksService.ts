/**
 * QuickBooks Integration Service
 * 
 * Frontend client for the qb-auth and qb-sync Supabase Edge Functions.
 * Handles OAuth connection, invoice syncing, and sync status tracking.
 */

import { invokeEdgeFunction } from './edgeAuth';
import type { Invoice, SupplierInvoice, QBSyncStatus, QBConnectionStatus } from '../types';

// Phase 1c: all QB Edge Function calls now go through `invokeEdgeFunction`,
// which attaches the server-issued user JWT from sessionStorage and reads
// the Supabase anon key from Vite env — no more hardcoded JWT in the bundle.
async function callEdgeFunction(fnName: string, action: string, options: {
    method?: 'GET' | 'POST';
    body?: any;
    params?: Record<string, string>;
} = {}): Promise<any> {
    const { method = 'GET', body, params = {} } = options;
    return invokeEdgeFunction(fnName, {
        method,
        body,
        params: { action, ...params },
    });
}

// ── OAuth Connection ─────────────────────────────────────────

/**
 * Initiates QuickBooks OAuth flow by opening a popup to the consent page.
 * Returns a promise that resolves when the OAuth callback completes.
 */
export async function connectToQuickBooks(companyId: string): Promise<boolean> {
    const data = await callEdgeFunction('qb-auth', 'authorize', {
        params: { companyId },
    });

    if (!data.authUrl) throw new Error('No authorization URL returned');

    return new Promise((resolve) => {
        // Open OAuth popup
        const popup = window.open(
            data.authUrl,
            'qb-auth',
            'width=600,height=700,menubar=no,toolbar=no,location=no'
        );

        // Listen for the callback message from the popup
        const handler = (event: MessageEvent) => {
            if (event.data?.type === 'QB_AUTH_SUCCESS') {
                window.removeEventListener('message', handler);
                resolve(true);
            }
        };
        window.addEventListener('message', handler);

        // Fallback: check if popup was closed without completing
        const interval = setInterval(() => {
            if (popup?.closed) {
                clearInterval(interval);
                window.removeEventListener('message', handler);
                resolve(false);
            }
        }, 1000);
    });
}

/**
 * Checks if QuickBooks is connected for the given company.
 */
export async function getQBConnectionStatus(companyId: string): Promise<QBConnectionStatus> {
    const data = await callEdgeFunction('qb-auth', 'status', {
        params: { companyId },
    });

    return {
        connected: data.connected,
        realmId: data.realmId,
        lastRefreshed: data.lastRefreshed,
    };
}

/**
 * Disconnects QuickBooks for the given company.
 */
export async function disconnectQuickBooks(companyId: string): Promise<void> {
    await callEdgeFunction('qb-auth', 'disconnect', {
        method: 'POST',
        body: { companyId },
    });
}

// ── QB Items (Products / Services) ───────────────────────────

export interface QBItem {
    id: string;
    name: string;
    type: string;
    fullyQualifiedName: string;
}

// Hardcoded fallback items when QB API is unavailable
const FALLBACK_ITEMS: QBItem[] = [
    { id: 'fb-1', name: 'COTTON 100%', type: 'NonInventory', fullyQualifiedName: 'COTTON 100%' },
    { id: 'fb-2', name: 'COTTON POLYESTER', type: 'NonInventory', fullyQualifiedName: 'COTTON POLYESTER' },
    { id: 'fb-3', name: 'CLIPS AND CUTTERS', type: 'NonInventory', fullyQualifiedName: 'CLIPS AND CUTTERS' },
    { id: 'fb-4', name: 'COTTON GIN MOTES', type: 'NonInventory', fullyQualifiedName: 'COTTON GIN MOTES' },
    { id: 'fb-5', name: 'COTTON POLYESTER LOW GRADES', type: 'NonInventory', fullyQualifiedName: 'COTTON POLYESTER LOW GRADES' },
    { id: 'fb-6', name: 'COTTON POLYESTER PNEUMAFIL', type: 'NonInventory', fullyQualifiedName: 'COTTON POLYESTER PNEUMAFIL' },
    { id: 'fb-7', name: 'COTTON POLYESTER SWEEPS', type: 'NonInventory', fullyQualifiedName: 'COTTON POLYESTER SWEEPS' },
    { id: 'fb-8', name: 'COTTON POLYESTER THREAD WASTES', type: 'NonInventory', fullyQualifiedName: 'COTTON POLYESTER THREAD WASTES' },
    { id: 'fb-9', name: 'POLYAMIDE 6', type: 'NonInventory', fullyQualifiedName: 'POLYAMIDE 6' },
    { id: 'fb-10', name: 'POLYAMIDE 66', type: 'NonInventory', fullyQualifiedName: 'POLYAMIDE 66' },
    { id: 'fb-11', name: 'POLYCARBONATE', type: 'NonInventory', fullyQualifiedName: 'POLYCARBONATE' },
    { id: 'fb-12', name: 'POLYPROPYLENE', type: 'NonInventory', fullyQualifiedName: 'POLYPROPYLENE' },
    { id: 'fb-13', name: 'POLYETHYLENE', type: 'NonInventory', fullyQualifiedName: 'POLYETHYLENE' },
    { id: 'fb-14', name: 'POLYESTER', type: 'NonInventory', fullyQualifiedName: 'POLYESTER' },
    { id: 'fb-15', name: 'COMMISSION ON SALES', type: 'Service', fullyQualifiedName: 'COMMISSION ON SALES' },
];

let _cachedItems: QBItem[] | null = null;

/**
 * Fetches all active Products/Services from QuickBooks.
 * Falls back to hardcoded list if API call fails.
 */
export async function fetchQBItems(companyId: string, forceRefresh = false): Promise<QBItem[]> {
    if (_cachedItems && !forceRefresh) return _cachedItems;

    try {
        const data = await callEdgeFunction('qb-sync', 'query-items', {
            params: { companyId },
        });
        const apiItems = (data.items || []) as QBItem[];
        if (apiItems.length > 0) {
            _cachedItems = apiItems;
            return _cachedItems;
        }
    } catch (e) {
        console.warn('QB items API failed, using fallback list:', e);
    }

    _cachedItems = FALLBACK_ITEMS;
    return _cachedItems;
}

// ── Sync Operations ──────────────────────────────────────────

/**
 * Syncs a single payable (supplier invoice) to QuickBooks as a Bill.
 */
export async function syncPayableBill(companyId: string, invoice: SupplierInvoice): Promise<QBSyncStatus> {
    const data = await callEdgeFunction('qb-sync', 'sync-bill', {
        method: 'POST',
        body: { companyId, invoice },
    });

    return {
        synced: true,
        qbEntityId: data.qbEntityId,
        qbEntityType: 'Bill',
        syncedAt: new Date().toISOString(),
    };
}

/**
 * Voids an invoice directly in QuickBooks by its QB Invoice Id.
 * QBO marks the invoice status as Voided and zeroes out the balance.
 */
export async function voidQbInvoice(companyId: string, qbInvoiceId: string): Promise<{ success: boolean; voidedAt: string }> {
    const data = await callEdgeFunction('qb-sync', 'void-invoice', {
        method: 'POST',
        body: { companyId, qbInvoiceId },
    });
    return { success: !!data.success, voidedAt: data.voidedAt };
}

/**
 * Syncs a single receivable (invoice) to QuickBooks as an Invoice.
 */
export async function syncReceivableInvoice(companyId: string, invoice: Invoice): Promise<QBSyncStatus> {
    const data = await callEdgeFunction('qb-sync', 'sync-invoice', {
        method: 'POST',
        body: { companyId, invoice },
    });

    return {
        synced: true,
        qbEntityId: data.qbEntityId,
        qbEntityType: 'Invoice',
        syncedAt: new Date().toISOString(),
    };
}

/**
 * Checks the QB sync status for a single invoice.
 */
export async function getSyncStatus(sourceId: string, sourceTable: 'invoices_suppliers' | 'invoices'): Promise<QBSyncStatus> {
    const data = await callEdgeFunction('qb-sync', 'sync-status', {
        params: { sourceId, sourceTable },
    });

    return {
        synced: data.synced || false,
        qbEntityId: data.qbEntityId,
        qbEntityType: data.qbEntityType,
        syncedAt: data.syncedAt,
        error: data.error,
    };
}

/**
 * Batch-checks QB sync status for multiple invoices.
 * Returns a map of source_id → QBSyncStatus.
 */
export async function batchGetSyncStatuses(
    sourceIds: string[],
    sourceTable: 'invoices_suppliers' | 'invoices'
): Promise<Record<string, QBSyncStatus>> {
    if (sourceIds.length === 0) return {};

    const data = await callEdgeFunction('qb-sync', 'batch-status', {
        method: 'POST',
        body: { sourceIds, sourceTable },
    });

    const result: Record<string, QBSyncStatus> = {};
    for (const id of sourceIds) {
        if (data.statuses?.[id]) {
            result[id] = {
                synced: true,
                qbEntityId: data.statuses[id].qbEntityId,
                qbEntityType: data.statuses[id].qbEntityType,
                syncedAt: data.statuses[id].syncedAt,
            };
        } else {
            result[id] = { synced: false };
        }
    }

    return result;
}

/**
 * Syncs multiple payables to QuickBooks as Bills.
 * Returns results per invoice.
 */
export async function bulkSyncPayables(
    companyId: string,
    invoices: SupplierInvoice[]
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const inv of invoices) {
        try {
            await syncPayableBill(companyId, inv);
            results.push({ id: inv.id, success: true });
        } catch (err: any) {
            results.push({ id: inv.id, success: false, error: err.message });
        }
    }

    return results;
}

/**
 * Syncs multiple receivables to QuickBooks as Invoices.
 * Returns results per invoice.
 */
export async function bulkSyncReceivables(
    companyId: string,
    invoices: Invoice[]
): Promise<Array<{ id: string; success: boolean; error?: string }>> {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const inv of invoices) {
        try {
            await syncReceivableInvoice(companyId, inv);
            results.push({ id: inv.id, success: true });
        } catch (err: any) {
            results.push({ id: inv.id, success: false, error: err.message });
        }
    }

    return results;
}

/**
 * Checks QB for paid bills and updates app status.
 * Returns summary of what was updated.
 */
export async function checkPaymentStatuses(companyId: string): Promise<{
    checked: number;
    paidCount: number;
    updated: string[];
    errors?: string[];
}> {
    const data = await callEdgeFunction('qb-sync', 'check-payment-status', {
        method: 'POST',
        body: { companyId },
    });
    return {
        checked: data.checked || 0,
        paidCount: data.paidCount || 0,
        updated: data.updated || [],
        errors: data.errors,
    };
}

// ── Customers & Statements ───────────────────────────────────

export interface QBCustomer {
    id: string;
    displayName: string;
    balance: number;
    primaryEmail?: string;
}

export interface QBStatementInvoice {
    id: string;
    docNumber: string;
    txnDate: string;
    dueDate: string | null;
    customerName: string;
    totalAmount: number;
    balance: number;
    currency: string;
}

export interface QBStatementPayment {
    id: string;
    txnDate: string;
    customerName: string;
    totalAmount: number;
    appliedAmount: number;
    unappliedAmount: number;
    paymentRefNum: string;
    paymentMethod: string;
    currency: string;
    appliedInvoices: string[];
}

export interface QBStatementReceipt {
    id: string;
    kind: 'deposit' | 'payment';
    txnDate: string;
    totalAmount: number;
    appliedAmount: number;
    unappliedAmount: number;
    paymentRefNum: string;
    paymentMethod: string;
    currency: string;
    appliedInvoices: string[];
    paymentIds: string[];
    depositAccount?: string;
    paymentCount: number;
}

export interface QBCustomerStatement {
    customerName: string;
    customerId: string | null;
    startDate: string;
    endDate: string;
    invoices: QBStatementInvoice[];
    payments: QBStatementPayment[];
    receipts?: QBStatementReceipt[];
    totals: {
        totalInvoiced: number;
        totalPaid: number;
        outstandingBalance: number;
    };
}

let _cachedCustomers: QBCustomer[] | null = null;

/**
 * Fetches active Customers from QuickBooks for dropdown filters.
 */
export async function fetchQBCustomers(companyId: string, forceRefresh = false): Promise<QBCustomer[]> {
    if (_cachedCustomers && !forceRefresh) return _cachedCustomers;

    const data = await callEdgeFunction('qb-sync', 'query-customers', {
        params: { companyId },
    });
    _cachedCustomers = (data.customers || []) as QBCustomer[];
    return _cachedCustomers;
}

/**
 * Fetches a customer statement (invoices vs payments) from QuickBooks
 * filtered by customer name and a date range (TxnDate).
 *
 * customerName uses QB's LIKE match against DisplayName.
 * startDate / endDate are ISO dates (YYYY-MM-DD); either can be omitted.
 */
export async function fetchCustomerStatement(
    companyId: string,
    customerName: string,
    startDate?: string,
    endDate?: string,
): Promise<QBCustomerStatement> {
    const params: Record<string, string> = { companyId };
    if (customerName) params.customerName = customerName;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const data = await callEdgeFunction('qb-sync', 'customer-statement', { params });
    return data as QBCustomerStatement;
}
