// QuickBooks Sync — Supabase Edge Function
// Creates Bills (payables) and Invoices (receivables) in QuickBooks Online
// URL: https://qfskvevighylzzmyiwre.supabase.co/functions/v1/qb-sync

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

// Per-request CORS headers. The router rebinds this before dispatching.
// (Keeps all existing handler signatures — they close over this symbol.)
let corsHeaders: Record<string, string> = {};

const QB_API_BASE = "https://quickbooks.api.intuit.com/v3/company";
const QB_SANDBOX_API_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getEnv(key: string): string {
    const val = Deno.env.get(key);
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

function getSupabase() {
    return createClient(
        getEnv("SUPABASE_URL"),
        getEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
}

function getApiBase(): string {
    const useSandbox = Deno.env.get("QB_USE_SANDBOX") === "true";
    return useSandbox ? QB_SANDBOX_API_BASE : QB_API_BASE;
}

// ── Token Management ─────────────────────────────────────────

async function getValidToken(companyId: string): Promise<{ accessToken: string; realmId: string }> {
    const supabase = getSupabase();

    // Try exact company match first
    let { data: tokenRow, error } = await supabase
        .from("qb_tokens")
        .select("*")
        .eq("company_id", companyId)
        .single();

    // Fallback: if no exact match, try to find any valid QB token
    if (error || !tokenRow) {
        console.log(`No QB token for company_id="${companyId}", trying fallback...`);
        const { data: anyToken, error: anyErr } = await supabase
            .from("qb_tokens")
            .select("*")
            .order("updated_at", { ascending: false })
            .limit(1)
            .single();

        if (anyErr || !anyToken) {
            throw new Error("QuickBooks is not connected. Please connect via Settings first.");
        }
        console.log(`Using fallback QB token from company_id="${anyToken.company_id}"`);
        tokenRow = anyToken;
    }

    // Check if token is expired (with 5 min buffer)
    const expiresAt = new Date(tokenRow.token_expiry);
    const now = new Date(Date.now() + 5 * 60 * 1000);

    if (expiresAt > now) {
        return { accessToken: tokenRow.access_token, realmId: tokenRow.realm_id };
    }

    // Token expired — refresh it
    console.log("Access token expired, refreshing...");
    const clientId = getEnv("QB_CLIENT_ID");
    const clientSecret = getEnv("QB_CLIENT_SECRET");

    const tokenResp = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenRow.refresh_token,
        }),
    });

    if (!tokenResp.ok) {
        const err = await tokenResp.text();
        throw new Error(`Token refresh failed: ${err}. Please reconnect QuickBooks.`);
    }

    const newTokens = await tokenResp.json();
    const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

    await supabase
        .from("qb_tokens")
        .update({
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token,
            token_expiry: newExpiry,
            updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);

    return { accessToken: newTokens.access_token, realmId: tokenRow.realm_id };
}

// ── QBO API Helpers ──────────────────────────────────────────

async function qboRequest(method: string, path: string, accessToken: string, body?: any): Promise<any> {
    const url = `${getApiBase()}${path}`;
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
    };

    const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await resp.json();

    if (!resp.ok) {
        const fault = data?.Fault?.Error?.[0];
        const msg = fault?.Detail || fault?.Message || JSON.stringify(data);
        throw new Error(`QBO API error (${resp.status}): ${msg}`);
    }

    return data;
}

// ── Find or Create Vendor ────────────────────────────────────

async function findOrCreateVendor(name: string, accessToken: string, realmId: string): Promise<string> {
    if (!name) throw new Error("Vendor/Supplier name is required");

    // Sanitize name: remove non-ASCII chars that break QB query parser
    const cleanName = name.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
    const displayName = cleanName.substring(0, 100);
    const safeName = displayName.replace(/'/g, "\\'");

    try {
        const query = encodeURIComponent(`select * from Vendor where DisplayName = '${safeName}'`);
        const result = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);
        if (result.QueryResponse?.Vendor?.length > 0) {
            return result.QueryResponse.Vendor[0].Id;
        }
    } catch (e: any) {
        console.warn(`Vendor exact lookup failed for "${displayName}":`, e.message);
    }

    // Try LIKE search with first word
    try {
        const firstWord = safeName.split(/\s+/)[0];
        if (firstWord.length >= 3) {
            const likeQuery = encodeURIComponent(`select * from Vendor where DisplayName LIKE '%${firstWord}%'`);
            const retry = await qboRequest("GET", `/${realmId}/query?query=${likeQuery}`, accessToken);
            if (retry.QueryResponse?.Vendor?.length > 0) {
                const match = retry.QueryResponse.Vendor.find(
                    (v: any) => v.DisplayName.toLowerCase() === displayName.toLowerCase()
                ) || retry.QueryResponse.Vendor[0];
                return match.Id;
            }
        }
    } catch (e: any) {
        console.warn(`Vendor LIKE lookup failed:`, e.message);
    }

    // Auto-create vendor
    console.log(`Creating new QBO Vendor: ${displayName}`);
    try {
        const created = await qboRequest("POST", `/${realmId}/vendor`, accessToken, {
            DisplayName: displayName,
        });
        return created.Vendor.Id;
    } catch (err: any) {
        if (err.message?.includes("already exists")) {
            console.log(`Vendor "${displayName}" already exists, retrying lookup...`);
            const firstWord = safeName.split(/\s+/)[0];
            const likeQuery = encodeURIComponent(`select * from Vendor where DisplayName LIKE '%${firstWord}%'`);
            const retry2 = await qboRequest("GET", `/${realmId}/query?query=${likeQuery}`, accessToken);
            if (retry2.QueryResponse?.Vendor?.length > 0) {
                const match = retry2.QueryResponse.Vendor.find(
                    (v: any) => v.DisplayName.toLowerCase() === displayName.toLowerCase()
                ) || retry2.QueryResponse.Vendor[0];
                return match.Id;
            }
        }
        throw err;
    }
}

// ── Find or Create Customer ──────────────────────────────────

async function findOrCreateCustomer(name: string, accessToken: string, realmId: string): Promise<string> {
    if (!name) throw new Error("Customer name is required");

    // Sanitize name: remove non-ASCII chars that break QB query parser, trim whitespace
    const cleanName = name.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
    const displayName = cleanName.substring(0, 100); // QB max 100 chars for DisplayName
    const safeName = displayName.replace(/'/g, "\\'");

    try {
        const query = encodeURIComponent(`select * from Customer where DisplayName = '${safeName}'`);
        const result = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);

        if (result.QueryResponse?.Customer?.length > 0) {
            return result.QueryResponse.Customer[0].Id;
        }
    } catch (e: any) {
        console.warn(`Customer exact lookup failed for "${displayName}":`, e.message);
        // Fall through to LIKE search
    }

    // Try LIKE search with first word
    try {
        const firstWord = safeName.split(/\s+/)[0];
        if (firstWord.length >= 3) {
            const likeQuery = encodeURIComponent(`select * from Customer where DisplayName LIKE '%${firstWord}%'`);
            const retry = await qboRequest("GET", `/${realmId}/query?query=${likeQuery}`, accessToken);
            if (retry.QueryResponse?.Customer?.length > 0) {
                const match = retry.QueryResponse.Customer.find(
                    (c: any) => c.DisplayName.toLowerCase() === displayName.toLowerCase()
                ) || retry.QueryResponse.Customer[0];
                return match.Id;
            }
        }
    } catch (e: any) {
        console.warn(`Customer LIKE lookup failed:`, e.message);
    }

    // Auto-create customer
    console.log(`Creating new QBO Customer: ${displayName}`);
    try {
        const created = await qboRequest("POST", `/${realmId}/customer`, accessToken, {
            DisplayName: displayName,
        });
        return created.Customer.Id;
    } catch (err: any) {
        // If "name already exists", try broader search
        if (err.message?.includes("already exists")) {
            console.log(`Customer "${displayName}" already exists, retrying lookup...`);
            const firstWord = safeName.split(/\s+/)[0];
            const likeQuery = encodeURIComponent(`select * from Customer where DisplayName LIKE '%${firstWord}%'`);
            const retry2 = await qboRequest("GET", `/${realmId}/query?query=${likeQuery}`, accessToken);
            if (retry2.QueryResponse?.Customer?.length > 0) {
                const match = retry2.QueryResponse.Customer.find(
                    (c: any) => c.DisplayName.toLowerCase() === displayName.toLowerCase()
                ) || retry2.QueryResponse.Customer[0];
                return match.Id;
            }
        }
        throw err;
    }
}

// ── Log Sync Result ──────────────────────────────────────────

async function logSync(sourceTable: string, sourceId: string, qbEntityType: string, qbEntityId: string | null, status: string, errorMessage?: string) {
    const supabase = getSupabase();
    await supabase.from("qb_sync_log").insert({
        source_table: sourceTable,
        source_id: sourceId,
        qb_entity_type: qbEntityType,
        qb_entity_id: qbEntityId,
        sync_status: status,
        error_message: errorMessage || null,
        synced_at: new Date().toISOString(),
    });
}

// ── Helper: find QB Item by name ──────────────────────────────

async function findQBItemByName(name: string, accessToken: string, realmId: string): Promise<string | null> {
    if (!name) return null;
    try {
        const safeName = name.replace(/'/g, "\\'");

        // First try FullyQualifiedName match (app sends fullyQualifiedName)
        const fqnQuery = encodeURIComponent(`select * from Item where FullyQualifiedName = '${safeName}'`);
        const fqnResult = await qboRequest("GET", `/${realmId}/query?query=${fqnQuery}`, accessToken);
        if (fqnResult.QueryResponse?.Item?.length > 0) {
            return fqnResult.QueryResponse.Item[0].Id;
        }

        // Then try exact Name match
        const query = encodeURIComponent(`select * from Item where Name = '${safeName}'`);
        const result = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);
        if (result.QueryResponse?.Item?.length > 0) {
            return result.QueryResponse.Item[0].Id;
        }

        // Try LIKE search as fallback using the last segment (after colon)
        const shortName = name.includes(":") ? name.split(":").pop()!.trim() : name;
        const safeShort = shortName.replace(/'/g, "\\'");
        const likeQuery = encodeURIComponent(`select * from Item where Name LIKE '%${safeShort.split(/\s+/)[0]}%'`);
        const retry = await qboRequest("GET", `/${realmId}/query?query=${likeQuery}`, accessToken);
        if (retry.QueryResponse?.Item?.length > 0) {
            const match = retry.QueryResponse.Item.find(
                (i: any) => i.FullyQualifiedName?.toLowerCase() === name.toLowerCase() ||
                    i.Name.toLowerCase() === shortName.toLowerCase()
            ) || retry.QueryResponse.Item[0];
            return match.Id;
        }
    } catch (e) {
        console.warn(`Item lookup failed for "${name}":`, e);
    }
    return null;
}

// ── Sync Payable as QBO Bill ─────────────────────────────────

async function syncBill(req: Request): Promise<Response> {
    const { companyId, invoice } = await req.json();
    if (!companyId || !invoice) {
        return new Response(
            JSON.stringify({ error: "companyId and invoice are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        // Find or create vendor
        const vendorName = invoice.supplier || invoice.shipperName;
        const vendorId = await findOrCreateVendor(vendorName, accessToken, realmId);

        // Find QB Item for the selected Product/Service
        const productService = invoice.qb_product_service || "";
        let qbItemId: string | null = null;
        if (productService) {
            qbItemId = await findQBItemByName(productService, accessToken, realmId);
        }

        // Parse line items
        let items: any[] = [];
        try {
            items = typeof invoice.items === "string" ? JSON.parse(invoice.items) : (invoice.items || []);
        } catch { items = []; }

        // Build Bill lines using ItemBasedExpenseLineDetail when we have a QB Item
        let lines: any[];
        if (qbItemId && items.length > 0) {
            // Use Item-based lines with the selected Product/Service
            lines = items.map((item: any, idx: number) => ({
                DetailType: "ItemBasedExpenseLineDetail",
                Amount: parseFloat(item.amount) || (parseFloat(item.unit_price || "0") * parseFloat(item.quantity || "1")),
                Description: item.description || item.productName || `Line ${idx + 1}`,
                ItemBasedExpenseLineDetail: {
                    ItemRef: { value: qbItemId },
                    Qty: parseFloat(item.quantity) || 1,
                    UnitPrice: parseFloat(item.unit_price) || parseFloat(item.amount) || 0,
                    BillableStatus: "NotBillable",
                },
            }));
        } else if (items.length > 0) {
            // Fallback: account-based with COGS account
            lines = items.map((item: any, idx: number) => ({
                DetailType: "AccountBasedExpenseLineDetail",
                Amount: parseFloat(item.amount) || (parseFloat(item.unit_price || "0") * parseFloat(item.quantity || "1")),
                Description: item.description || item.productName || `Line ${idx + 1}`,
                AccountBasedExpenseLineDetail: {
                    AccountRef: { value: "7" }, // Cost of Goods Sold
                },
            }));
        } else {
            // Single line with total amount
            lines = [{
                DetailType: qbItemId ? "ItemBasedExpenseLineDetail" : "AccountBasedExpenseLineDetail",
                Amount: parseFloat(invoice.totalAmount) || 0,
                Description: `Invoice ${invoice.invoiceNumber || ""}`,
                ...(qbItemId
                    ? { ItemBasedExpenseLineDetail: { ItemRef: { value: qbItemId }, Qty: 1, UnitPrice: parseFloat(invoice.totalAmount) || 0 } }
                    : { AccountBasedExpenseLineDetail: { AccountRef: { value: "7" } } }
                ),
            }];
        }

        // Calculate due date
        let dueDate = invoice.dueDate;
        if (!dueDate && invoice.invoiceDate && invoice.paymentTerms) {
            const base = new Date(invoice.invoiceDate);
            const days = parseInt((invoice.paymentTerms.match(/\d+/) || ["0"])[0], 10);
            if (days > 0) {
                base.setDate(base.getDate() + days);
                dueDate = base.toISOString().split("T")[0];
            }
        }

        // Map payment terms to QB terms
        let salesTermRef: any = undefined;
        if (invoice.paymentTerms) {
            const termName = invoice.paymentTerms.toUpperCase().replace(/\s+/g, " ").trim();
            // Try to find the QB Term
            try {
                const tq = encodeURIComponent(`select * from Term where Name = '${termName}'`);
                const termResult = await qboRequest("GET", `/${realmId}/query?query=${tq}`, accessToken);
                if (termResult.QueryResponse?.Term?.length > 0) {
                    salesTermRef = { value: termResult.QueryResponse.Term[0].Id };
                }
            } catch { /* ignore term lookup failures */ }
        }

        const billPayload: any = {
            VendorRef: { value: vendorId },
            DocNumber: invoice.invoiceNumber || undefined,
            TxnDate: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().split("T")[0] : undefined,
            DueDate: dueDate ? new Date(dueDate).toISOString().split("T")[0] : undefined,
            Line: lines,
            PrivateNote: invoice.memo || `Synced from X-Solution (ID: ${invoice.id})`,
        };

        if (salesTermRef) {
            billPayload.SalesTermRef = salesTermRef;
        }

        if (invoice.currency && invoice.currency !== "USD") {
            billPayload.CurrencyRef = { value: invoice.currency };
        }

        const result = await qboRequest("POST", `/${realmId}/bill`, accessToken, billPayload);
        const qbBillId = result.Bill.Id;

        await logSync("invoices_suppliers", invoice.id, "Bill", qbBillId, "success");

        return new Response(
            JSON.stringify({ success: true, qbEntityId: qbBillId, qbEntityType: "Bill" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("syncBill error:", err);
        await logSync("invoices_suppliers", invoice.id, "Bill", null, "error", err.message);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to sync bill" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Sync Receivable as QBO Invoice ───────────────────────────

async function syncInvoice(req: Request): Promise<Response> {
    const { companyId, invoice } = await req.json();
    if (!companyId || !invoice) {
        return new Response(
            JSON.stringify({ error: "companyId and invoice are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        // Find or create customer
        const customerName = invoice.soldTo || invoice.shipperName || invoice.billToName;
        const customerId = await findOrCreateCustomer(customerName, accessToken, realmId);

        // Find QB Item for the selected Product/Service
        const productService = invoice.qb_product_service || "";
        let qbItemId: string | null = null;
        if (productService) {
            qbItemId = await findQBItemByName(productService, accessToken, realmId);
        }
        // Fallback to default item ID "1" if no match found
        const itemRefValue = qbItemId || "1";

        // Parse line items
        let items: any[] = [];
        try {
            items = typeof invoice.items === "string" ? JSON.parse(invoice.items) : (invoice.items || []);
        } catch { items = []; }

        // Build Invoice lines — ensure Amount = UnitPrice * Qty for QBO validation
        const lines: any[] = items.length > 0
            ? items.map((item: any, idx: number) => {
                const qty = parseFloat(item.quantity || item.qty || "1") || 1;
                const unitPrice = parseFloat(item.unitPrice || item.unit_price || item.price || "0") || 0;
                const rawAmount = parseFloat(item.amount || "0") || 0;

                // If we have a valid unitPrice, use it; otherwise derive from amount/qty
                let finalUnitPrice = unitPrice;
                let finalQty = qty;
                if (finalUnitPrice === 0 && rawAmount > 0) {
                    finalUnitPrice = rawAmount / finalQty;
                }
                const finalAmount = Math.round(finalUnitPrice * finalQty * 100) / 100;

                return {
                    DetailType: "SalesItemLineDetail",
                    Amount: finalAmount,
                    Description: item.description || item.productName || item.product || `Line ${idx + 1}`,
                    SalesItemLineDetail: {
                        ItemRef: { value: itemRefValue },
                        Qty: finalQty,
                        UnitPrice: finalUnitPrice,
                    },
                };
            })
            : [{
                DetailType: "SalesItemLineDetail",
                Amount: parseFloat(invoice.totalAmount) || 0,
                Description: `Invoice ${invoice.invoiceNumber || ""}`,
                SalesItemLineDetail: {
                    ItemRef: { value: itemRefValue },
                    Qty: 1,
                    UnitPrice: parseFloat(invoice.totalAmount) || 0,
                },
            }];

        // Calculate due date
        let dueDate = invoice.dueDate;
        if (!dueDate && invoice.invoiceDate && invoice.paymentTerms) {
            const base = new Date(invoice.invoiceDate);
            const days = parseInt((invoice.paymentTerms.match(/\d+/) || ["0"])[0], 10);
            if (days > 0) {
                base.setDate(base.getDate() + days);
                dueDate = base.toISOString().split("T")[0];
            }
        }

        // Map payment terms to QB terms
        let salesTermRef: any = undefined;
        if (invoice.paymentTerms) {
            const termName = invoice.paymentTerms.toUpperCase().replace(/\s+/g, " ").trim();
            try {
                const tq = encodeURIComponent(`select * from Term where Name = '${termName}'`);
                const termResult = await qboRequest("GET", `/${realmId}/query?query=${tq}`, accessToken);
                if (termResult.QueryResponse?.Term?.length > 0) {
                    salesTermRef = { value: termResult.QueryResponse.Term[0].Id };
                }
            } catch { /* ignore */ }
        }

        const invoicePayload: any = {
            CustomerRef: { value: customerId },
            DocNumber: invoice.invoiceNumber || undefined,
            TxnDate: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().split("T")[0] : undefined,
            DueDate: dueDate ? new Date(dueDate).toISOString().split("T")[0] : undefined,
            Line: lines,
            PrivateNote: invoice.memo || `Synced from X-Solution (ID: ${invoice.id})`,
        };

        if (salesTermRef) {
            invoicePayload.SalesTermRef = salesTermRef;
        }

        if (invoice.currency && invoice.currency !== "USD") {
            invoicePayload.CurrencyRef = { value: invoice.currency };
        }

        const result = await qboRequest("POST", `/${realmId}/invoice`, accessToken, invoicePayload);
        const qbInvoiceId = result.Invoice.Id;

        await logSync("invoices", invoice.id, "Invoice", qbInvoiceId, "success");

        return new Response(
            JSON.stringify({ success: true, qbEntityId: qbInvoiceId, qbEntityType: "Invoice" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("syncInvoice error:", err);
        await logSync("invoices", invoice.id, "Invoice", null, "error", err.message);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to sync invoice" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Void an invoice in QuickBooks ────────────────────────────
//
// QBO's void flow: fetch the invoice to get its current SyncToken,
// then POST to `/invoice?operation=void` with { Id, SyncToken }. QBO
// returns the voided invoice (status=Voided, Balance=0).

async function voidInvoice(req: Request): Promise<Response> {
    const { companyId, qbInvoiceId } = await req.json();
    if (!companyId || !qbInvoiceId) {
        return new Response(
            JSON.stringify({ error: "companyId and qbInvoiceId are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        const current = await qboRequest("GET", `/${realmId}/invoice/${qbInvoiceId}`, accessToken);
        const syncToken = current?.Invoice?.SyncToken;
        if (syncToken === undefined || syncToken === null) {
            throw new Error(`Invoice ${qbInvoiceId} not found in QuickBooks`);
        }

        const result = await qboRequest(
            "POST",
            `/${realmId}/invoice?operation=void`,
            accessToken,
            { Id: qbInvoiceId, SyncToken: String(syncToken) },
        );

        return new Response(
            JSON.stringify({
                success: true,
                qbEntityId: qbInvoiceId,
                qbEntityType: "Invoice",
                status: result?.Invoice?.PrivateNote || "Voided",
                voidedAt: new Date().toISOString(),
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("voidInvoice error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to void invoice" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Check sync status for a single invoice ───────────────────

async function checkSyncStatus(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const sourceId = url.searchParams.get("sourceId");
    const sourceTable = url.searchParams.get("sourceTable");

    if (!sourceId || !sourceTable) {
        return new Response(
            JSON.stringify({ error: "sourceId and sourceTable are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("qb_sync_log")
        .select("*")
        .eq("source_id", sourceId)
        .eq("source_table", sourceTable)
        .order("synced_at", { ascending: false })
        .limit(1)
        .single();

    if (error || !data) {
        return new Response(
            JSON.stringify({ synced: false }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
        JSON.stringify({
            synced: data.sync_status === "success",
            qbEntityId: data.qb_entity_id,
            qbEntityType: data.qb_entity_type,
            syncedAt: data.synced_at,
            error: data.sync_status === "error" ? data.error_message : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

// ── Batch check sync status ──────────────────────────────────

async function batchSyncStatus(req: Request): Promise<Response> {
    const { sourceIds, sourceTable } = await req.json();

    if (!sourceIds || !sourceTable) {
        return new Response(
            JSON.stringify({ error: "sourceIds and sourceTable are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
        .from("qb_sync_log")
        .select("*")
        .in("source_id", sourceIds)
        .eq("source_table", sourceTable)
        .eq("sync_status", "success");

    const statusMap: Record<string, any> = {};
    if (data) {
        for (const row of data) {
            // Keep the latest successful sync per source_id
            if (!statusMap[row.source_id] || new Date(row.synced_at) > new Date(statusMap[row.source_id].syncedAt)) {
                statusMap[row.source_id] = {
                    synced: true,
                    qbEntityId: row.qb_entity_id,
                    qbEntityType: row.qb_entity_type,
                    syncedAt: row.synced_at,
                };
            }
        }
    }

    return new Response(
        JSON.stringify({ statuses: statusMap }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
}

// ── Query QB Items (Products / Services) ─────────────────────

async function queryItems(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || "ALL";

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        const query = encodeURIComponent("select * from Item MAXRESULTS 1000");
        const result = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);

        const items = (result.QueryResponse?.Item || []).map((item: any) => ({
            id: item.Id,
            name: item.Name,
            type: item.Type, // Service, Inventory, NonInventory, etc.
            fullyQualifiedName: item.FullyQualifiedName,
            active: item.Active,
        })).filter((item: any) => item.active !== false);

        return new Response(
            JSON.stringify({ items }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("queryItems error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to query items" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Create QB Items (Products / Services) ─────────────────────

async function bulkCreateItems(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || "ALL";

    // Items to create in QB
    const ITEMS_TO_CREATE = [
        { name: "COTTON 100%", type: "NonInventory" },
        { name: "COTTON POLYESTER", type: "NonInventory" },
        { name: "CLIPS AND CUTTERS", type: "NonInventory" },
        { name: "COTTON GIN MOTES", type: "NonInventory" },
        { name: "COTTON POLYESTER LOW GRADES", type: "NonInventory" },
        { name: "COTTON POLYESTER PNEUMAFIL", type: "NonInventory" },
        { name: "COTTON POLYESTER SWEEPS", type: "NonInventory" },
        { name: "COTTON POLYESTER THREAD WASTES", type: "NonInventory" },
        { name: "POLYAMIDE 6", type: "NonInventory" },
        { name: "POLYAMIDE 66", type: "NonInventory" },
        { name: "POLYCARBONATE", type: "NonInventory" },
        { name: "POLYPROPYLENE", type: "NonInventory" },
        { name: "POLYETHYLENE", type: "NonInventory" },
        { name: "POLYESTER", type: "NonInventory" },
        { name: "COMMISSION ON SALES", type: "Service" },
    ];

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        // First, query existing items to avoid duplicates
        const query = encodeURIComponent("select Name from Item MAXRESULTS 1000");
        const existingResult = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);
        const existingNames = new Set(
            (existingResult.QueryResponse?.Item || []).map((item: any) => item.Name.toUpperCase())
        );

        // Find the "Sales" income account (required for item creation)
        const acctQuery = encodeURIComponent("select * from Account where AccountType = 'Income' MAXRESULTS 5");
        const acctResult = await qboRequest("GET", `/${realmId}/query?query=${acctQuery}`, accessToken);
        const incomeAccount = acctResult.QueryResponse?.Account?.[0];
        if (!incomeAccount) {
            throw new Error("No Income account found in QuickBooks. Please create one first.");
        }

        const results: Array<{ name: string; status: string; id?: string; error?: string }> = [];

        for (const item of ITEMS_TO_CREATE) {
            if (existingNames.has(item.name.toUpperCase())) {
                results.push({ name: item.name, status: "already_exists" });
                continue;
            }

            try {
                const payload: any = {
                    Name: item.name,
                    Type: item.type,
                    IncomeAccountRef: {
                        value: incomeAccount.Id,
                        name: incomeAccount.Name,
                    },
                };

                // NonInventory items also need an ExpenseAccountRef
                if (item.type === "NonInventory") {
                    // Find a COGS or Expense account
                    const expQuery = encodeURIComponent("select * from Account where AccountType = 'Cost of Goods Sold' MAXRESULTS 1");
                    const expResult = await qboRequest("GET", `/${realmId}/query?query=${expQuery}`, accessToken);
                    const expenseAccount = expResult.QueryResponse?.Account?.[0];
                    if (expenseAccount) {
                        payload.ExpenseAccountRef = {
                            value: expenseAccount.Id,
                            name: expenseAccount.Name,
                        };
                    }
                }

                const created = await qboRequest("POST", `/${realmId}/item`, accessToken, payload);
                results.push({
                    name: item.name,
                    status: "created",
                    id: created.Item?.Id,
                });
            } catch (err: any) {
                results.push({
                    name: item.name,
                    status: "error",
                    error: err.message,
                });
            }
        }

        return new Response(
            JSON.stringify({ results }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("bulkCreateItems error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to create items" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Check QB Payment Statuses ────────────────────────────────

async function checkPaymentStatuses(req: Request): Promise<Response> {
    const { companyId } = await req.json();
    if (!companyId) {
        return new Response(
            JSON.stringify({ error: "companyId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        const { accessToken, realmId } = await getValidToken(companyId);
        const supabase = getSupabase();

        // Get all successfully synced bills from qb_sync_log
        const { data: syncLogs, error: logErr } = await supabase
            .from("qb_sync_log")
            .select("source_id, qb_entity_id")
            .eq("source_table", "invoices_suppliers")
            .eq("qb_entity_type", "Bill")
            .eq("sync_status", "success")
            .not("qb_entity_id", "is", null);

        if (logErr || !syncLogs || syncLogs.length === 0) {
            return new Response(
                JSON.stringify({ updated: [], message: "No synced bills found" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // De-duplicate by source_id (keep latest)
        const billMap = new Map<string, string>();
        for (const log of syncLogs) {
            billMap.set(log.source_id, log.qb_entity_id);
        }

        const updated: string[] = [];
        const errors: string[] = [];

        for (const [sourceId, qbBillId] of billMap) {
            try {
                const billResult = await qboRequest("GET", `/${realmId}/bill/${qbBillId}`, accessToken);
                const bill = billResult.Bill;
                if (bill && parseFloat(bill.Balance) === 0) {
                    // Bill is paid in QB — update app status
                    const { error: updateErr } = await supabase
                        .from("invoices_suppliers")
                        .update({
                            status: "Paid",
                            paid_date: new Date().toISOString().split("T")[0],
                        })
                        .eq("id", sourceId)
                        .neq("status", "Paid"); // Only update if not already Paid

                    if (!updateErr) {
                        updated.push(sourceId);
                    }
                }
            } catch (e: any) {
                console.warn(`Failed to check bill ${qbBillId}:`, e.message);
                errors.push(`Bill ${qbBillId}: ${e.message}`);
            }
        }

        return new Response(
            JSON.stringify({
                updated,
                checked: billMap.size,
                paidCount: updated.length,
                errors: errors.length > 0 ? errors : undefined,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("checkPaymentStatuses error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to check payment statuses" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── List QB Customers ────────────────────────────────────────

async function queryCustomers(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || "ALL";

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        const query = encodeURIComponent("select Id, DisplayName, Balance, Active, PrimaryEmailAddr from Customer where Active = true MAXRESULTS 1000");
        const result = await qboRequest("GET", `/${realmId}/query?query=${query}`, accessToken);

        const customers = (result.QueryResponse?.Customer || []).map((c: any) => ({
            id: c.Id,
            displayName: c.DisplayName,
            balance: typeof c.Balance === "number" ? c.Balance : parseFloat(c.Balance || "0"),
            primaryEmail: c.PrimaryEmailAddr?.Address || "",
        }));

        return new Response(
            JSON.stringify({ customers }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("queryCustomers error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to query customers" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Customer Statement (Invoices vs Payments) ───────────────

async function customerStatement(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || "ALL";
    const customerName = url.searchParams.get("customerName") || "";
    const startDate = url.searchParams.get("startDate") || "";
    const endDate = url.searchParams.get("endDate") || "";

    try {
        const { accessToken, realmId } = await getValidToken(companyId);

        // Resolve customer id from name (LIKE match)
        let customerId: string | null = null;
        let resolvedName = customerName;
        if (customerName) {
            const safeName = customerName.replace(/'/g, "\\'").substring(0, 100);
            const custQuery = encodeURIComponent(`select Id, DisplayName from Customer where DisplayName LIKE '%${safeName}%' MAXRESULTS 5`);
            const custResult = await qboRequest("GET", `/${realmId}/query?query=${custQuery}`, accessToken);
            const match = custResult.QueryResponse?.Customer?.[0];
            if (!match) {
                return new Response(
                    JSON.stringify({ error: `Customer not found: ${customerName}` }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            customerId = match.Id;
            resolvedName = match.DisplayName;
        }

        // Date clause — QB TxnDate uses ISO (YYYY-MM-DD)
        const dateClauses: string[] = [];
        if (startDate) dateClauses.push(`TxnDate >= '${startDate}'`);
        if (endDate) dateClauses.push(`TxnDate <= '${endDate}'`);

        // Invoices
        const invWhere: string[] = [];
        if (customerId) invWhere.push(`CustomerRef = '${customerId}'`);
        invWhere.push(...dateClauses);
        const invSql = `select * from Invoice${invWhere.length ? " where " + invWhere.join(" and ") : ""} ORDERBY TxnDate MAXRESULTS 1000`;
        const invResult = await qboRequest("GET", `/${realmId}/query?query=${encodeURIComponent(invSql)}`, accessToken);

        const invoices = (invResult.QueryResponse?.Invoice || []).map((inv: any) => ({
            id: inv.Id,
            docNumber: inv.DocNumber || "",
            txnDate: inv.TxnDate,
            dueDate: inv.DueDate || null,
            customerName: inv.CustomerRef?.name || resolvedName,
            totalAmount: typeof inv.TotalAmt === "number" ? inv.TotalAmt : parseFloat(inv.TotalAmt || "0"),
            balance: typeof inv.Balance === "number" ? inv.Balance : parseFloat(inv.Balance || "0"),
            currency: inv.CurrencyRef?.value || "USD",
        }));

        // Payments
        const payWhere: string[] = [];
        if (customerId) payWhere.push(`CustomerRef = '${customerId}'`);
        payWhere.push(...dateClauses);
        const paySql = `select * from Payment${payWhere.length ? " where " + payWhere.join(" and ") : ""} ORDERBY TxnDate MAXRESULTS 1000`;
        const payResult = await qboRequest("GET", `/${realmId}/query?query=${encodeURIComponent(paySql)}`, accessToken);

        const payments = (payResult.QueryResponse?.Payment || []).map((p: any) => {
            // Lines that are applied to invoices; sum those to get the applied portion.
            const appliedLines = (p.Line || []).filter((line: any) =>
                (line.LinkedTxn || []).some((lt: any) => lt.TxnType === "Invoice")
            );
            const appliedInvoices = appliedLines
                .flatMap((line: any) => line.LinkedTxn || [])
                .filter((lt: any) => lt.TxnType === "Invoice")
                .map((lt: any) => lt.TxnId);
            const appliedAmount = appliedLines.reduce((sum: number, line: any) => {
                const amt = typeof line.Amount === "number" ? line.Amount : parseFloat(line.Amount || "0");
                return sum + (isNaN(amt) ? 0 : amt);
            }, 0);
            return {
                id: p.Id,
                txnDate: p.TxnDate,
                customerName: p.CustomerRef?.name || resolvedName,
                // TotalAmt is the gross amount received from the customer (bank deposit
                // value for this payment), before it is split across invoices.
                totalAmount: typeof p.TotalAmt === "number" ? p.TotalAmt : parseFloat(p.TotalAmt || "0"),
                // Portion of the payment actually applied to invoices.
                appliedAmount,
                unappliedAmount: typeof p.UnappliedAmt === "number" ? p.UnappliedAmt : parseFloat(p.UnappliedAmt || "0"),
                paymentRefNum: p.PaymentRefNum || "",
                paymentMethod: p.PaymentMethodRef?.name || "",
                currency: p.CurrencyRef?.value || "USD",
                appliedInvoices,
                // DepositToAccountRef on Payment indicates the bank account the payment
                // was booked directly to (used when QB skips the Undeposited Funds step).
                // We use it as a grouping key for the "same-day bank deposit" heuristic.
                depositToAccountId: p.DepositToAccountRef?.value || "",
                depositToAccountName: p.DepositToAccountRef?.name || "",
            };
        });

        // Deposits — group payments that were deposited together into a single
        // bank deposit, so we can display ONE row per bank transaction.
        // Deposit.Line[].LinkedTxn with TxnType === "Payment" links to Payment ids.
        // We can't filter Deposits by customer in QBO (deposits span customers),
        // so we fetch deposits in the date range and then join on payment id.
        const depWhere: string[] = [];
        depWhere.push(...dateClauses);
        const depSql = `select * from Deposit${depWhere.length ? " where " + depWhere.join(" and ") : ""} ORDERBY TxnDate MAXRESULTS 1000`;
        let deposits: any[] = [];
        try {
            const depResult = await qboRequest("GET", `/${realmId}/query?query=${encodeURIComponent(depSql)}`, accessToken);
            deposits = depResult.QueryResponse?.Deposit || [];
        } catch (e) {
            // Deposit entity access can fail in some QB editions; degrade gracefully.
            console.warn("Deposit query failed, falling back to payment-level receipts:", e);
            deposits = [];
        }

        // paymentId -> depositId
        const paymentToDeposit = new Map<string, string>();
        const depositMeta = new Map<string, { id: string; txnDate: string; totalAmount: number; account: string }>();
        for (const d of deposits) {
            const dTotal = typeof d.TotalAmt === "number" ? d.TotalAmt : parseFloat(d.TotalAmt || "0");
            depositMeta.set(d.Id, {
                id: d.Id,
                txnDate: d.TxnDate,
                totalAmount: isNaN(dTotal) ? 0 : dTotal,
                account: d.DepositToAccountRef?.name || "",
            });
            for (const line of d.Line || []) {
                for (const lt of line.LinkedTxn || []) {
                    if (lt.TxnType === "Payment" && lt.TxnId) {
                        paymentToDeposit.set(String(lt.TxnId), d.Id);
                    }
                }
            }
        }

        // Build receipts: one row per bank deposit (grouping its payments from
        // THIS customer), or one row per standalone payment that isn't in a deposit.
        type Receipt = {
            id: string;
            kind: "deposit" | "payment";
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
        };

        const byDeposit = new Map<string, typeof payments>();
        const standalone: typeof payments = [];
        for (const p of payments) {
            const depId = paymentToDeposit.get(String(p.id));
            if (depId && depositMeta.has(depId)) {
                if (!byDeposit.has(depId)) byDeposit.set(depId, []);
                byDeposit.get(depId)!.push(p);
            } else {
                standalone.push(p);
            }
        }

        const receipts: Receipt[] = [];
        for (const [depId, ps] of byDeposit.entries()) {
            const meta = depositMeta.get(depId)!;
            const total = ps.reduce((s, p) => s + (p.totalAmount || 0), 0);
            const applied = ps.reduce((s, p) => s + (p.appliedAmount || 0), 0);
            const unapplied = ps.reduce((s, p) => s + (p.unappliedAmount || 0), 0);
            const methods = Array.from(new Set(ps.map((p) => p.paymentMethod).filter(Boolean)));
            const refs = Array.from(new Set(ps.map((p) => p.paymentRefNum).filter(Boolean)));
            const invoiceIds = Array.from(new Set(ps.flatMap((p) => p.appliedInvoices)));
            receipts.push({
                id: `dep-${depId}`,
                kind: "deposit",
                txnDate: meta.txnDate || ps[0]?.txnDate,
                totalAmount: total, // this customer's portion of the deposit
                appliedAmount: applied,
                unappliedAmount: unapplied,
                paymentRefNum: refs.join(", "),
                paymentMethod: methods.join(", "),
                currency: ps[0]?.currency || "USD",
                appliedInvoices: invoiceIds,
                paymentIds: ps.map((p) => p.id),
                depositAccount: meta.account,
                paymentCount: ps.length,
            });
        }
        // Heuristic fallback: when QB doesn't expose a matching Deposit (common
        // when payments are booked directly to a bank account, skipping
        // Undeposited Funds), group the remaining standalone payments by
        // (txnDate, depositToAccountId). Two+ payments from the same customer
        // hitting the same bank account on the same day almost always represent
        // a single wire/check split across invoices.
        const byDayAccount = new Map<string, typeof payments>();
        const trulyStandalone: typeof payments = [];
        for (const p of standalone) {
            const key = `${p.txnDate}|${p.depositToAccountId || ""}`;
            if (!byDayAccount.has(key)) byDayAccount.set(key, []);
            byDayAccount.get(key)!.push(p);
        }
        for (const [key, ps] of byDayAccount.entries()) {
            if (ps.length < 2) {
                trulyStandalone.push(...ps);
                continue;
            }
            const total = ps.reduce((s, p) => s + (p.totalAmount || 0), 0);
            const applied = ps.reduce((s, p) => s + (p.appliedAmount || 0), 0);
            const unapplied = ps.reduce((s, p) => s + (p.unappliedAmount || 0), 0);
            const methods = Array.from(new Set(ps.map((p) => p.paymentMethod).filter(Boolean)));
            const refs = Array.from(new Set(ps.map((p) => p.paymentRefNum).filter(Boolean)));
            const invoiceIds = Array.from(new Set(ps.flatMap((p) => p.appliedInvoices)));
            const acctName = ps.find((p) => p.depositToAccountName)?.depositToAccountName || "";
            receipts.push({
                id: `grp-${key}`,
                kind: "deposit",
                txnDate: ps[0].txnDate,
                totalAmount: total,
                appliedAmount: applied,
                unappliedAmount: unapplied,
                paymentRefNum: refs.join(", "),
                paymentMethod: methods.join(", "),
                currency: ps[0]?.currency || "USD",
                appliedInvoices: invoiceIds,
                paymentIds: ps.map((p) => p.id),
                depositAccount: acctName,
                paymentCount: ps.length,
            });
        }
        for (const p of trulyStandalone) {
            receipts.push({
                id: `pay-${p.id}`,
                kind: "payment",
                txnDate: p.txnDate,
                totalAmount: p.totalAmount,
                appliedAmount: p.appliedAmount,
                unappliedAmount: p.unappliedAmount,
                paymentRefNum: p.paymentRefNum,
                paymentMethod: p.paymentMethod,
                currency: p.currency,
                appliedInvoices: p.appliedInvoices,
                paymentIds: [p.id],
                depositAccount: p.depositToAccountName || "",
                paymentCount: 1,
            });
        }
        receipts.sort((a, b) => (a.txnDate || "").localeCompare(b.txnDate || ""));

        const totalInvoiced = invoices.reduce((s: number, i: any) => s + (i.totalAmount || 0), 0);
        const totalPaid = payments.reduce((s: number, p: any) => s + (p.totalAmount || 0), 0);
        const outstandingBalance = invoices.reduce((s: number, i: any) => s + (i.balance || 0), 0);

        return new Response(
            JSON.stringify({
                customerName: resolvedName,
                customerId,
                startDate,
                endDate,
                invoices,
                payments,
                receipts,
                totals: {
                    totalInvoiced,
                    totalPaid,
                    outstandingBalance,
                },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("customerStatement error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Failed to build customer statement" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
}

// ── Main Router ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    // Rebind per-request CORS so nested handlers pick up the right origin.
    corsHeaders = buildCorsHeaders(req);

    // All qb-sync actions are client-invoked — require a valid JWT.
    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;

    try {
        const url = new URL(req.url);
        const action = url.searchParams.get("action") || url.pathname.split("/").pop() || "";

        switch (action) {
            case "sync-bill":
                return await syncBill(req);
            case "sync-invoice":
                return await syncInvoice(req);
            case "void-invoice":
                return await voidInvoice(req);
            case "sync-status":
                return await checkSyncStatus(req);
            case "batch-status":
                return await batchSyncStatus(req);
            case "query-items":
                return await queryItems(req);
            case "bulk-create-items":
                return await bulkCreateItems(req);
            case "check-payment-status":
                return await checkPaymentStatuses(req);
            case "query-customers":
                return await queryCustomers(req);
            case "customer-statement":
                return await customerStatement(req);
            default:
                return new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
        }
    } catch (err: any) {
        console.error("qb-sync error:", err);
        return new Response(
            JSON.stringify({ error: err.message || "Internal error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
