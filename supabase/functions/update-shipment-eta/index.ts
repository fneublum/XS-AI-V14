// Daily shipment-ETA refresh — Supabase Edge Function.
//
// Iterates every active invoice (in-transit window: has bookingNumber,
// not FULFILLED, invoice within last 120 days) and asks a container-
// tracking provider for the latest ETD / ETA, then writes those back
// onto the linked `bookings` row.
//
// Provider-agnostic: reads `system_settings.shipment_tracker_credentials`
// to pick which provider to call. Supported today:
//   • shipsgo  — pay-per-track, all major carriers (recommended for EC4)
//   • maersk   — free with registration, Maersk-operated containers only
//   • stub     — no-op for dry-run testing
//
// Auth: the function is intended to be invoked by a scheduled job
// (Supabase Cron). Calls require an `Authorization: Bearer <token>`
// header where the token equals the SHIPMENT_ETA_SHARED_SECRET env
// var (set via `supabase secrets set SHIPMENT_ETA_SHARED_SECRET=...`).
// A signed-in user with the same secret in `Authorization` also works
// for manual debug runs.
//
// To schedule: see docs/shipment-eta-setup.md for the pg_cron SQL.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHARED_SECRET = Deno.env.get('SHIPMENT_ETA_SHARED_SECRET') ?? '';
// How far back to scan invoices. Anything older than this window is
// assumed delivered or abandoned — skip to keep the function fast and
// avoid unnecessary provider charges.
const TRANSIT_LOOKBACK_DAYS = 120;

// ── Provider credentials shape ───────────────────────────────────
interface TrackerCredentials {
  provider: 'shipsgo' | 'maersk' | 'stub';
  /** Provider-specific config — schema varies. */
  config?: Record<string, unknown>;
}

interface TrackResult {
  etd: string | null;   // YYYY-MM-DD
  eta: string | null;
  source: string;       // human label for audit logs
}

// ── Helpers ──────────────────────────────────────────────────────

function corsJson(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Pick the first container number from an invoice's `containers` field.
// The column is a JSON-encoded array (sometimes wrapped as `{__meta,
// items}`) and each entry uses `container` or `containerNo` depending
// on which engine wrote it. Falls back to the BL number if no container
// list is present (some carriers accept BL as a tracking key).
function pickTrackingKey(inv: {
  containers?: unknown;
  bl?: string | null;
  bookingNumber?: string | null;
}): { key: string; type: 'container' | 'bl' | 'booking' } | null {
  const raw = inv.containers;
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  let list: unknown[] = [];
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) list = obj.items;
  }
  for (const c of list) {
    if (c && typeof c === 'object') {
      const r = c as Record<string, unknown>;
      const v = String(r.container ?? r.containerNo ?? '').trim();
      if (v) return { key: v.toUpperCase(), type: 'container' };
    }
  }
  const bl = (inv.bl ?? '').trim();
  if (bl) return { key: bl.toUpperCase(), type: 'bl' };
  const bk = (inv.bookingNumber ?? '').trim();
  if (bk) return { key: bk.toUpperCase(), type: 'booking' };
  return null;
}

// ── Providers ────────────────────────────────────────────────────

/**
 * ShipsGo — paid container-tracking API. Two-phase flow:
 *   1. POST /PostContainerInfo with `containerNumber` (charges 1 credit
 *      per unique container) → returns a numeric requestId.
 *   2. GET /GetContainerInfo with the requestId → returns timings.
 *
 * We cache (container → requestId) in `shipsgo_tracking_refs` so we
 * only POST once per container ever. On the daily run, registered
 * containers get a free GET; new ones are POSTed and skipped until
 * the next run (ShipsGo's carrier sync needs a few minutes/hours).
 *
 * Config: { authCode: string }
 */
async function trackShipsGo(
  key: string,
  config: Record<string, unknown>,
  ctx: { supabase: SupabaseClient },
): Promise<TrackResult | null> {
  const authCode = typeof config.authCode === 'string' ? config.authCode : '';
  if (!authCode) {
    console.warn('[update-shipment-eta] shipsgo: missing authCode in credentials');
    return null;
  }
  // 1. Look up the cached requestId for this container.
  const refRes = await ctx.supabase
    .from('shipsgo_tracking_refs')
    .select('request_id')
    .eq('container_number', key)
    .maybeSingle<{ request_id: string }>();
  let requestId = refRes.data?.request_id ?? null;

  // 2. If we've never registered this container, POST now to register
  //    it (1 credit). Skip the GET this run — ShipsGo needs time to
  //    pull data from the carrier; tomorrow's run will read it.
  if (!requestId) {
    try {
      const postUrl = 'https://shipsgo.com/api/v1.2/ContainerService/PostContainerInfo/';
      const form = new URLSearchParams({
        authCode,
        containerNumber: key,
        shippingLine: 'OTHERS', // ShipsGo auto-detects the carrier
      });
      const postResp = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!postResp.ok) {
        console.warn(`[update-shipment-eta] shipsgo POST non-200 for ${key}: ${postResp.status}`);
        return null;
      }
      const newId = (await postResp.text()).trim();
      if (!newId || !/^\d+$/.test(newId)) {
        console.warn(`[update-shipment-eta] shipsgo POST returned non-numeric for ${key}: "${newId}"`);
        return null;
      }
      requestId = newId;
      await ctx.supabase.from('shipsgo_tracking_refs').insert({
        container_number: key,
        request_id: requestId,
        shipping_line: 'OTHERS',
      });
      console.log(`[update-shipment-eta] shipsgo registered ${key} → ${requestId} (1 credit)`);
      // Bail out — no data yet for this container.
      return null;
    } catch (e) {
      console.warn(`[update-shipment-eta] shipsgo POST failed for ${key}:`, e);
      return null;
    }
  }

  // 3. We have a requestId. GET the latest tracking data (free).
  try {
    const getUrl = new URL('https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/');
    getUrl.searchParams.set('authCode', authCode);
    getUrl.searchParams.set('requestId', requestId);
    const resp = await fetch(getUrl.toString(), { method: 'GET' });
    if (!resp.ok) {
      console.warn(`[update-shipment-eta] shipsgo GET non-200 for ${key} (${requestId}): ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    // Response shape: array of one object with FirstETA, LastETA,
    // POLATA (actual time of arrival at POL), etc. Field names vary
    // slightly across plans — handle the common ones.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    const obj = row as Record<string, unknown>;
    // ShipsGo's "no data yet" response is { Message: "..." } not an array.
    if (typeof obj.Message === 'string' && obj.Message.includes('No Data')) return null;
    const etd = isoDate(obj.POLATA) ?? isoDate(obj.POLATD) ?? isoDate(obj.LoadingDate);
    const eta = isoDate(obj.LastETA) ?? isoDate(obj.FirstETA) ?? isoDate(obj.ETA);
    // Update the cache row with what we just saw so we have a record
    // of when the last successful read happened.
    if (etd || eta) {
      await ctx.supabase.from('shipsgo_tracking_refs').update({
        last_seen_at: new Date().toISOString(),
        last_eta: eta,
        last_etd: etd,
      }).eq('container_number', key);
    }
    if (!etd && !eta) return null;
    return { etd, eta, source: 'shipsgo' };
  } catch (e) {
    console.warn(`[update-shipment-eta] shipsgo GET failed for ${key}:`, e);
    return null;
  }
}

/**
 * Maersk public tracking API — free with developer registration.
 * Docs: https://developer.maerskline.com/apis/track
 * Config: { consumerKey: string }
 *
 * Only meaningful for Maersk-operated containers — prefixes MAEU,
 * MRKU, MSKU, POCU, SEAU. Skip the call when the key clearly belongs
 * to a different carrier.
 */
async function trackMaersk(
  key: string,
  config: Record<string, unknown>,
): Promise<TrackResult | null> {
  const consumerKey = typeof config.consumerKey === 'string' ? config.consumerKey : '';
  if (!consumerKey) {
    console.warn('[update-shipment-eta] maersk: missing consumerKey in credentials');
    return null;
  }
  const maerskPrefixes = ['MAEU', 'MRKU', 'MSKU', 'POCU', 'SEAU'];
  const prefix = key.slice(0, 4);
  if (!maerskPrefixes.includes(prefix)) {
    return null; // Not a Maersk container.
  }
  const url = `https://api.maersk.com/track/${encodeURIComponent(key)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Consumer-Key': consumerKey,
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) {
      console.warn(`[update-shipment-eta] maersk non-200 for ${key}: ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    // Maersk's response is a deep object. Pull the latest event with
    // the right type. This is a simplified parser — production code
    // should map every event type carefully.
    const events: Array<Record<string, unknown>> = Array.isArray((data as any)?.transportEvents)
      ? (data as any).transportEvents
      : [];
    let etd: string | null = null;
    let eta: string | null = null;
    for (const ev of events) {
      const type = String(ev.eventClassifierCode ?? '');
      const ts = isoDate(ev.eventDateTime);
      if (!ts) continue;
      // EST = estimated, ACT = actual, PLN = planned.
      if (String(ev.eventCode).includes('LOAD') && (type === 'ACT' || type === 'EST')) {
        etd = ts;
      }
      if (String(ev.eventCode).includes('DISC') && (type === 'ACT' || type === 'EST')) {
        eta = ts;
      }
    }
    if (!etd && !eta) return null;
    return { etd, eta, source: 'maersk' };
  } catch (e) {
    console.warn(`[update-shipment-eta] maersk fetch failed for ${key}:`, e);
    return null;
  }
}

/** Dry-run stub — returns null for every key so the function can be
 *  scheduled before a real provider is wired up. Useful for confirming
 *  the iteration logic and DB writes without spending provider quota. */
async function trackStub(_key: string): Promise<TrackResult | null> {
  return null;
}

async function trackContainer(
  key: string,
  creds: TrackerCredentials,
  ctx: { supabase: SupabaseClient },
): Promise<TrackResult | null> {
  switch (creds.provider) {
    case 'shipsgo':  return trackShipsGo(key, creds.config ?? {}, ctx);
    case 'maersk':   return trackMaersk(key, creds.config ?? {});
    case 'stub':     return trackStub(key);
    default:
      console.warn(`[update-shipment-eta] unknown provider: ${creds.provider}`);
      return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  bookingNumber: string | null;
  containers: unknown;
  bl: string | null;
  companyId: string | null;
}

interface BookingRow {
  bookingNumber: string;
  etd: string | null;
  eta: string | null;
}

interface RunSummary {
  scanned: number;
  trackable: number;
  /** ShipsGo POST registrations this run (each costs 1 credit). */
  registered: number;
  updated: number;
  unchanged: number;
  noProviderHit: number;
  noTrackingKey: number;
  /** Bookings skipped because ETA is already in the past (delivered). */
  alreadyArrived: number;
  errors: number;
}

interface ErrorDetail {
  bookingNumber: string;
  key: string;
  keyType: 'container' | 'bl' | 'booking';
  stage: 'tracker' | 'booking-read' | 'booking-update';
  message: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = buildCorsHeaders(req);

  // Auth: accept EITHER the shared-secret bearer (cron path) OR a
  // signed-in app JWT (on-demand "Refresh ETAs" button on the Logistics
  // Follow Up page). Cron stays headless; the page reuses normal user
  // sessions without needing to embed the secret.
  const got = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const isCron = SHARED_SECRET && got === SHARED_SECRET;
  if (!isCron) {
    if (!SHARED_SECRET) {
      console.warn('[update-shipment-eta] SHIPMENT_ETA_SHARED_SECRET not set — cron path disabled');
    }
    const auth = await requireUser(req, corsHeaders);
    if ('response' in auth) return auth.response;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Load tracker credentials from system_settings (server-side only —
  // the row is RLS-locked away from client sessions because the key
  // matches the `credential` regex).
  const credRes = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'shipment_tracker_credentials')
    .maybeSingle();
  if (credRes.error) {
    return corsJson({ error: `Failed to load credentials: ${credRes.error.message}` }, 500, corsHeaders);
  }
  if (!credRes.data || !credRes.data.value) {
    return corsJson({
      error: 'shipment_tracker_credentials not configured. See docs/shipment-eta-setup.md.',
    }, 500, corsHeaders);
  }
  const creds = credRes.data.value as TrackerCredentials;
  if (!creds.provider) {
    return corsJson({ error: 'shipment_tracker_credentials.provider missing' }, 500, corsHeaders);
  }

  // Pull in-transit invoices.
  const cutoff = new Date(Date.now() - TRANSIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const invRes = await supabase
    .from('invoices')
    .select('id, invoiceNumber, invoiceDate, bookingNumber, containers, bl, companyId')
    .not('bookingNumber', 'is', null)
    .gte('invoiceDate', cutoff);
  if (invRes.error) {
    return corsJson({ error: `Invoice scan failed: ${invRes.error.message}` }, 500, corsHeaders);
  }
  const invoices = (invRes.data as InvoiceRow[] | null) ?? [];

  // Group invoices by booking number — we update bookings, not each
  // invoice. One tracker call per unique container key.
  const byBooking = new Map<string, InvoiceRow[]>();
  for (const inv of invoices) {
    const bn = (inv.bookingNumber ?? '').trim();
    if (!bn) continue;
    const arr = byBooking.get(bn) ?? [];
    arr.push(inv);
    byBooking.set(bn, arr);
  }

  const summary: RunSummary = {
    scanned: invoices.length,
    trackable: 0,
    registered: 0,
    updated: 0,
    unchanged: 0,
    noProviderHit: 0,
    noTrackingKey: 0,
    alreadyArrived: 0,
    errors: 0,
  };

  // "Already arrived" cutoff. We treat a booking as delivered (and skip
  // the tracker call entirely) when its stored ETA is at least one full
  // day before today. We leave a 24h window so a same-day arrival still
  // gets a final refresh — the carrier sometimes lands a few hours
  // early/late and we want the actual time on record.
  const todayIso = new Date().toISOString().slice(0, 10);
  const isArrived = (eta: string | null): boolean => {
    if (!eta) return false;
    const v = isoDate(eta) ?? eta.slice(0, 10);
    return v < todayIso;
  };
  const errorDetails: ErrorDetail[] = [];

  // Snapshot the cache before this run so we can detect new
  // registrations afterwards (the trackShipsGo helper inserts rows
  // when it POSTs a new container).
  const refsBefore = creds.provider === 'shipsgo'
    ? await supabase.from('shipsgo_tracking_refs').select('container_number').then(r => new Set((r.data ?? []).map((x: any) => x.container_number as string)))
    : new Set<string>();

  for (const [bookingNumber, invList] of byBooking) {
    // Find a tracking key across this booking's invoices.
    let trackingKey: { key: string; type: 'container' | 'bl' | 'booking' } | null = null;
    for (const inv of invList) {
      trackingKey = pickTrackingKey(inv);
      if (trackingKey) break;
    }
    if (!trackingKey) {
      summary.noTrackingKey += invList.length;
      continue;
    }
    summary.trackable++;

    // Read the booking row FIRST. If it already shows an ETA in the
    // past, the shipment has arrived — skip the tracker call entirely
    // (saves ShipsGo calls + keeps the summary honest).
    const bkRes = await supabase
      .from('bookings')
      .select('bookingNumber, etd, eta')
      .eq('bookingNumber', bookingNumber)
      .maybeSingle<BookingRow>();
    if (bkRes.error) {
      summary.errors++;
      errorDetails.push({
        bookingNumber, key: trackingKey.key, keyType: trackingKey.type,
        stage: 'booking-read', message: bkRes.error.message,
      });
      continue;
    }
    const current = bkRes.data;
    if (!current) {
      // No booking row yet — could create one, but for now skip and
      // let the user manually create the booking first.
      summary.noProviderHit++;
      continue;
    }
    if (isArrived(current.eta)) {
      summary.alreadyArrived++;
      continue;
    }

    let result: TrackResult | null = null;
    try {
      result = await trackContainer(trackingKey.key, creds, { supabase });
    } catch (e) {
      summary.errors++;
      const msg = e instanceof Error ? e.message : String(e);
      errorDetails.push({
        bookingNumber, key: trackingKey.key, keyType: trackingKey.type,
        stage: 'tracker', message: msg,
      });
      console.warn(`[update-shipment-eta] tracker threw for booking ${bookingNumber}:`, e);
      continue;
    }
    if (!result) {
      summary.noProviderHit++;
      continue;
    }

    const patch: Record<string, string | null> = {};
    if (result.etd && result.etd !== current.etd) patch.etd = result.etd;
    if (result.eta && result.eta !== current.eta) patch.eta = result.eta;
    if (Object.keys(patch).length === 0) {
      summary.unchanged++;
      continue;
    }
    const upd = await supabase
      .from('bookings')
      .update(patch)
      .eq('bookingNumber', bookingNumber);
    if (upd.error) {
      summary.errors++;
      errorDetails.push({
        bookingNumber, key: trackingKey.key, keyType: trackingKey.type,
        stage: 'booking-update', message: upd.error.message,
      });
      console.warn(`[update-shipment-eta] update failed for ${bookingNumber}:`, upd.error);
      continue;
    }
    summary.updated++;
    console.log(`[update-shipment-eta] ${bookingNumber} key=${trackingKey.key}(${trackingKey.type}) src=${result.source}`, patch);
  }

  // Post-run: count how many new container rows landed in the cache.
  if (creds.provider === 'shipsgo') {
    const refsAfter = await supabase.from('shipsgo_tracking_refs')
      .select('container_number')
      .then(r => new Set((r.data ?? []).map((x: any) => x.container_number as string)));
    for (const c of refsAfter) {
      if (!refsBefore.has(c)) summary.registered++;
    }
  }

  return corsJson({
    ok: true,
    summary,
    provider: creds.provider,
    ranAt: new Date().toISOString(),
    errorDetails,
  }, 200, corsHeaders);
});
