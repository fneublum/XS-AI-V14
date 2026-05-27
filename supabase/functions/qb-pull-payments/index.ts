// QuickBooks → Supabase transactions sync — Phase 4.
//
// Pulls AR receipts (Payment) and AP payments (BillPayment) from
// QuickBooks Online for a given company and upserts them into the
// unified `transactions` table with source='QB_SYNC' and qbId set
// to the QBO entity id. The unique constraint on qbId means re-runs
// of the same sync update in place instead of duplicating.
//
// Allocations are best-effort: a Payment that pays an invoice in QB
// includes a `Line[].LinkedTxn` reference; if we can resolve that
// invoice number to a row in our `invoices` table we create the
// matching transaction_allocations row.
//
// URL: https://<project>.supabase.co/functions/v1/qb-pull-payments
// Body: { companyId, since?: 'YYYY-MM-DD' }
// Returns: { pulled, allocated, errors }
//
// Designed to be safe to call repeatedly (idempotent via qbId upsert).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const QB_API_BASE         = 'https://quickbooks.api.intuit.com';
const QB_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com';
const QB_TOKEN_URL        = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function getEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function getSupabase() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

function getApiBase(): string {
  return Deno.env.get('QB_USE_SANDBOX') === 'true' ? QB_SANDBOX_API_BASE : QB_API_BASE;
}

/** Same logic as qb-sync.getValidToken — re-implemented to keep this
 *  function self-contained. Refreshes tokens within 5 minutes of
 *  expiry. Throws if no token row exists for the company. */
async function getValidToken(companyId: string): Promise<{ accessToken: string; realmId: string }> {
  const sb = getSupabase();
  const { data: tokenRow, error } = await sb
    .from('qb_tokens')
    .select('*')
    .eq('company_id', companyId)
    .single();
  if (error || !tokenRow) {
    throw new Error('QuickBooks is not connected for this company. Connect via Settings first.');
  }

  const expiresAt = new Date(tokenRow.token_expiry);
  const refreshBuffer = new Date(Date.now() + 5 * 60 * 1000);
  if (expiresAt > refreshBuffer) {
    return { accessToken: tokenRow.access_token, realmId: tokenRow.realm_id };
  }

  // Refresh
  const clientId = getEnv('QB_CLIENT_ID');
  const clientSecret = getEnv('QB_CLIENT_SECRET');
  const tokenResp = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  });
  if (!tokenResp.ok) {
    throw new Error(`Token refresh failed: ${await tokenResp.text()}. Reconnect QuickBooks.`);
  }
  const newTokens = await tokenResp.json();
  const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
  await sb.from('qb_tokens').update({
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    token_expiry: newExpiry,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId);
  return { accessToken: newTokens.access_token, realmId: tokenRow.realm_id };
}

async function qboQuery(query: string, accessToken: string, realmId: string): Promise<any> {
  const url = `${getApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`QBO query failed: ${r.status} ${await r.text()}`);
  return r.json();
}

interface PullResult {
  pulled: number;
  allocated: number;
  errors: { type: string; id: string; message: string }[];
}

function makeTxnId(): string {
  return `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function makeAllocId(): string {
  return `ALLOC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function pullPayments(companyId: string, since: string | null): Promise<PullResult> {
  const sb = getSupabase();
  const { accessToken, realmId } = await getValidToken(companyId);

  const result: PullResult = { pulled: 0, allocated: 0, errors: [] };

  // QBO QL — SELECT * FROM Payment / BillPayment ORDER BY TxnDate
  // since clause filters TxnDate
  const whereClause = since ? ` WHERE TxnDate >= '${since}'` : '';

  // ── AR (customer) Payments ────────────────────────────────────
  try {
    const arResp = await qboQuery(
      `SELECT * FROM Payment${whereClause} ORDER BY TxnDate MAXRESULTS 500`,
      accessToken, realmId,
    );
    const payments: any[] = arResp?.QueryResponse?.Payment ?? [];
    for (const p of payments) {
      try {
        const qbId = `qb:Payment:${p.Id}`;
        const total = Number(p.TotalAmt) || 0;
        if (total <= 0) continue;

        // Upsert transaction
        const txnId = makeTxnId();
        const customerRef = p.CustomerRef?.name ?? null;
        const txnDate = p.TxnDate ?? new Date().toISOString().slice(0, 10);

        // Check if this QBO Payment already exists
        const { data: existing } = await sb.from('transactions').select('id').eq('qbId', qbId).maybeSingle();

        if (existing) {
          // Update amount/date/counterparty in case they changed in QB
          await sb.from('transactions').update({
            txnDate,
            amount: total,
            counterpartyName: customerRef,
            qbSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await sb.from('transactions').insert({
            id: txnId,
            companyId,
            source: 'QB_SYNC',
            kind: 'PAYMENT_IN',
            txnDate,
            amount: total,
            currency: p.CurrencyRef?.value ?? 'USD',
            method: 'OTHER',  // QBO doesn't always expose method cleanly
            counterpartyType: 'CUSTOMER',
            counterpartyName: customerRef,
            reference: p.PaymentRefNum ?? null,
            memo: p.PrivateNote ?? null,
            status: 'MATCHED',
            qbId,
            qbSyncedAt: new Date().toISOString(),
          });

          // Allocations — match LinkedTxn → invoice
          const lines: any[] = p.Line ?? [];
          for (const line of lines) {
            const linked = (line.LinkedTxn ?? [])[0];
            if (!linked || linked.TxnType !== 'Invoice') continue;
            const allocAmount = Number(line.Amount) || 0;
            if (allocAmount <= 0) continue;
            // Find the invoice by qbId (we store qb info on invoices.qb_status / qb sync)
            // Best-effort: match by QBO invoice DocNumber → invoices.invoiceNumber
            const { data: invMatch } = await sb
              .from('qb_sync_log')
              .select('source_id')
              .eq('qb_entity_id', linked.TxnId)
              .eq('qb_entity_type', 'Invoice')
              .maybeSingle();
            const invoiceId = invMatch?.source_id;
            if (invoiceId) {
              await sb.from('transaction_allocations').insert({
                id: makeAllocId(),
                transactionId: txnId,
                invoiceId,
                amount: allocAmount,
              });
              result.allocated += 1;
            }
          }
          result.pulled += 1;
        }
      } catch (e: any) {
        result.errors.push({ type: 'Payment', id: String(p.Id), message: e.message ?? String(e) });
      }
    }
  } catch (e: any) {
    result.errors.push({ type: 'Payment', id: '*', message: e.message ?? String(e) });
  }

  // ── AP (supplier) BillPayments ────────────────────────────────
  try {
    const apResp = await qboQuery(
      `SELECT * FROM BillPayment${whereClause} ORDER BY TxnDate MAXRESULTS 500`,
      accessToken, realmId,
    );
    const bills: any[] = apResp?.QueryResponse?.BillPayment ?? [];
    for (const p of bills) {
      try {
        const qbId = `qb:BillPayment:${p.Id}`;
        const total = Number(p.TotalAmt) || 0;
        if (total <= 0) continue;

        const txnId = makeTxnId();
        const vendorRef = p.VendorRef?.name ?? null;
        const txnDate = p.TxnDate ?? new Date().toISOString().slice(0, 10);

        const { data: existing } = await sb.from('transactions').select('id').eq('qbId', qbId).maybeSingle();
        if (existing) {
          await sb.from('transactions').update({
            txnDate,
            amount: total,
            counterpartyName: vendorRef,
            qbSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await sb.from('transactions').insert({
            id: txnId,
            companyId,
            source: 'QB_SYNC',
            kind: 'PAYMENT_OUT',
            txnDate,
            amount: total,
            currency: p.CurrencyRef?.value ?? 'USD',
            method: p.PayType === 'Check' ? 'CHECK' : (p.PayType === 'CreditCard' ? 'CARD' : 'OTHER'),
            counterpartyType: 'SUPPLIER',
            counterpartyName: vendorRef,
            reference: p.PrivateNote ?? null,
            memo: p.PrivateNote ?? null,
            status: 'MATCHED',
            qbId,
            qbSyncedAt: new Date().toISOString(),
          });

          // Allocations: BillPayment.Line[].LinkedTxn[] → Bill (V14 supplier invoice)
          const lines: any[] = p.Line ?? [];
          for (const line of lines) {
            const linked = (line.LinkedTxn ?? [])[0];
            if (!linked || linked.TxnType !== 'Bill') continue;
            const allocAmount = Number(line.Amount) || 0;
            if (allocAmount <= 0) continue;
            const { data: billMatch } = await sb
              .from('qb_sync_log')
              .select('source_id')
              .eq('qb_entity_id', linked.TxnId)
              .eq('qb_entity_type', 'Bill')
              .maybeSingle();
            const supplierInvoiceId = billMatch?.source_id;
            if (supplierInvoiceId) {
              await sb.from('transaction_allocations').insert({
                id: makeAllocId(),
                transactionId: txnId,
                supplierInvoiceId,
                amount: allocAmount,
              });
              result.allocated += 1;
            }
          }
          result.pulled += 1;
        }
      } catch (e: any) {
        result.errors.push({ type: 'BillPayment', id: String(p.Id), message: e.message ?? String(e) });
      }
    }
  } catch (e: any) {
    result.errors.push({ type: 'BillPayment', id: '*', message: e.message ?? String(e) });
  }

  // Update last-sync timestamp on the qb_tokens row
  await sb.from('qb_tokens').update({
    last_payment_sync_at: new Date().toISOString(),
  }).eq('company_id', companyId);

  return result;
}

// ─── HTTP handler ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const cors = buildCorsHeaders(req);

  const authed = await requireUser(req);
  if (authed instanceof Response) return authed;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }),
      { status: 405, headers: { ...cors, 'content-type': 'application/json' } });
  }

  try {
    const body = await req.json();
    const companyId = String(body.companyId ?? '').trim();
    const since = body.since ? String(body.since) : null;
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'companyId required' }),
        { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
    }
    const result = await pullPayments(companyId, since);
    return new Response(JSON.stringify(result),
      { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }),
      { status: 500, headers: { ...cors, 'content-type': 'application/json' } });
  }
});
