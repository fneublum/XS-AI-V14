// Booking health check — finds active shipments past ETA that still
// have no linked Bill of Lading. Cross-references against the latest
// inbox-triage results so we can tell the user "a BL looking like
// yours arrived in Outlook; want to link it?"
//
// Pure detection — returns a list, does not mutate rows.

import { getSupabaseClient } from '../../services/supabase';
import type { TriageItem } from './inboxAutoTriage';

export interface BookingAlert {
  bookingId: string;
  bookingNumber: string;
  customerName: string | null;
  pod: string | null;
  eta: string | null;
  daysPastEta: number; // negative if eta in future (won't happen given our filter)
  status: string;
  /** A triage item whose doc type = BILL OF LADING and whose ref number
   *  mentions (or is mentioned by) the booking / BL chain. */
  suggestedBl?: TriageItem;
}

/** Loose matcher: does the triage ref appear inside the booking number
 *  or vice versa (case-insensitive, alphanumerics only). */
function refMatchesBooking(triageRef: string | null, bookingNumber: string | null): boolean {
  if (!triageRef || !bookingNumber) return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = norm(triageRef);
  const b = norm(bookingNumber);
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

export async function checkBookings(
  recentTriage: TriageItem[] = [],
): Promise<BookingAlert[]> {
  const sb = getSupabaseClient();
  const nowIso = new Date().toISOString();

  // Pull active bookings — anything not yet delivered. We do the
  // past-ETA filter client-side so bookings with null ETAs also
  // surface (they're arguably the most stuck).
  const { data, error } = await sb
    .from('bookings')
    .select('id, bookingNumber, customer, vesselVoyage, pol, pod, eta, status')
    .not('status', 'in', '("DELIVERED","CANCELLED","CLOSED","BL_ISSUED")')
    .order('eta', { ascending: true })
    .limit(50);
  if (error || !data) return [];

  // The bookings table has no BL-link column — query bill_landings in
  // parallel and pair by vesselVoyage match. A booking is considered
  // "has BL" if any BL row shares its vessel/voyage string.
  const { data: blRows } = await sb
    .from('bill_landings')
    .select('vesselVoyage')
    .not('vesselVoyage', 'is', null)
    .limit(500);
  const blVoyages = new Set<string>(
    ((blRows as any[] | null) ?? [])
      .map(r => String(r.vesselVoyage ?? '').trim().toUpperCase())
      .filter(Boolean),
  );

  const blCandidates = recentTriage.filter(t => t.docType === 'BILL OF LADING' || t.docType === 'PACKING LIST');

  const alerts: BookingAlert[] = [];
  for (const row of data as any[]) {
    const voyage = String(row.vesselVoyage ?? '').trim().toUpperCase();
    if (voyage && blVoyages.has(voyage)) continue; // BL already issued

    const etaStr = row.eta as string | null;
    let daysPast: number;
    if (etaStr) {
      const etaMs = new Date(etaStr).getTime();
      const nowMs = Date.parse(nowIso);
      daysPast = Math.floor((nowMs - etaMs) / (24 * 60 * 60 * 1000));
      // Only surface the actionable window:
      //   • not still clearly in the future (daysPast >= -1)
      //   • not ancient forgotten rows (daysPast <= 30)
      // Bookings > 30d overdue are almost always stale — they flood
      // the banner and drown out real attention items.
      if (daysPast < -1) continue;
      if (daysPast > 30) continue;
    } else {
      daysPast = Number.NaN;
    }

    const suggestedBl = blCandidates.find(t => refMatchesBooking(t.extractedRef, row.bookingNumber));

    alerts.push({
      bookingId: row.id,
      bookingNumber: row.bookingNumber ?? row.id,
      customerName: row.customer ?? null,
      pod: row.pod ?? null,
      eta: etaStr,
      daysPastEta: Number.isFinite(daysPast) ? daysPast : 0,
      status: row.status ?? 'AVAILABLE',
      suggestedBl,
    });
  }

  // Sort by most-overdue first; missing-ETA rows sink to the bottom.
  alerts.sort((a, b) => {
    const an = Number.isFinite(a.daysPastEta) ? a.daysPastEta : -999;
    const bn = Number.isFinite(b.daysPastEta) ? b.daysPastEta : -999;
    return bn - an;
  });
  return alerts;
}

/** Compact one-liner for the XS Agent chat. */
export function formatBookingAlert(a: BookingAlert): string {
  const noun = a.customerName ? ` for ${a.customerName}` : '';
  const lag = a.eta
    ? (a.daysPastEta > 0 ? `${a.daysPastEta}d past ETA` : 'at ETA')
    : 'no ETA set';
  const tail = a.suggestedBl
    ? ` — a possible BL arrived in your inbox: ${a.suggestedBl.attachmentName} (${a.suggestedBl.extractedRef ?? '?'}).`
    : ' — no BL in your inbox yet.';
  return `📦 Booking ${a.bookingNumber}${noun} is ${lag}${tail}`;
}
