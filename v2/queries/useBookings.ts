// Phase 3B — Bookings query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Booking {
  id: string;
  bookingNumber: string;
  customer: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  equipment: string | null;
  etd: string | null;
  eta: string | null;
  status: string;
  salesOrderId: string | null;
  /**
   * The agent that owns this booking, as a free-text string (compare with
   * `cargo_agents.name`). Values in the wild are messy — some rows have
   * a single name (e.g. `"KAPPALOG "`, trailing space), some have a
   * compound name (e.g. `"INFINITY/HUSKLOG/KAPPALOG "`), some use a
   * slightly different spelling (`"KappaLog Solutions Inc."`). The Agent
   * Portal matches with V1's case-insensitive contains-either-way rule —
   * see `matchesAnyAgent` below.
   */
  agentName: string | null;
  /** Free time at destination as stored on the booking. The DB column
   *  is text (values like `"21 Day(s)"`, `"7"`, `""`) so we surface it
   *  as a string and let the renderer pick a sensible display. */
  freeTime: string | null;
  /** Transit time in days, derived from `etd` → `eta` when both are
   *  parseable dates. `null` when either end is missing or unparseable. */
  transitDays: number | null;
  /** Cargo terminal cut-off — when containers must hit the terminal or
   *  the booking misses the vessel. Free-text in the DB (mixes bare
   *  dates and ISO timestamps), so rendering should `slice(0,10)` or
   *  pass through fmtDate(). */
  cargoCutOff: string | null;
}

interface Raw {
  id: string;
  bookingNumber: string | null;
  customer: string | null;
  vesselVoyage: string | null;
  pol: string | null;
  pod: string | null;
  equipment: string | null;
  etd: string | null;
  eta: string | null;
  status: string | null;
  salesOrderId: string | null;
  createdAt: string | null;
  agentName: string | null;
  freeTime: string | null;
  cargoCutOff: string | null;
}

/**
 * ETA - ETD in whole days. Booking dates come in a variety of formats
 * (`"18-Jan-2026 00:01"`, `"2026-04-04"`, `"20-Jan-2026"`). `Date.parse`
 * handles the ISO and RFC-2822ish forms; we normalise the dash-separated
 * month-name form before parsing.
 */
function parseBookingDate(s: string | null): number | null {
  if (!s) return null;
  const v = s.trim();
  if (!v) return null;
  // "18-Jan-2026 00:01" -> "18 Jan 2026 00:01"
  const normalised = /^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(v)
    ? v.replace(/-/g, ' ')
    : v;
  const t = Date.parse(normalised);
  return Number.isFinite(t) ? t : null;
}

function transitDaysBetween(etd: string | null, eta: string | null): number | null {
  const a = parseBookingDate(etd);
  const b = parseBookingDate(eta);
  if (a === null || b === null) return null;
  const days = Math.round((b - a) / 86400000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

/**
 * V1 parity: a booking's agentName matches a cargo agent if either
 * string contains the other (case-insensitive). Handles:
 *  - exact matches with trailing whitespace
 *  - `"KappaLog Solutions Inc."` vs `"KAPPALOG"` (substring)
 *  - `"INFINITY/HUSKLOG/KAPPALOG "` vs `"KAPPALOG"` (compound)
 *  - `"INFINITY"` vs `"INFINITY/HUSKLOG"` (abbreviated)
 * See /pages/LogisticsDocuments.tsx:110-120 for the original rule.
 */
function matchesAnyAgent(agentName: string | null, targets: string[]): boolean {
  if (!agentName) return false;
  const booking = agentName.toUpperCase().trim();
  if (!booking) return false;
  for (const raw of targets) {
    const t = (raw ?? '').toUpperCase().trim();
    if (!t) continue;
    if (booking.includes(t) || t.includes(booking)) return true;
  }
  return false;
}

/**
 * agentName can be a single string or an array — the Agent Portal passes
 * an array when the logged-in user is linked to multiple cargo_agents
 * rows (see AuthProvider.linkedEntityIds / AdminUsersV2 multi-select).
 *
 * Agent filtering is client-side (after a company-scoped fetch) because
 * booking agent names are messy — see matchesAnyAgent — and PostgREST
 * can't express the contains-either-way rule cleanly.
 */
export function useBookings(search?: string, agentName?: string | string[]) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';
  const agents = Array.isArray(agentName)
    ? agentName.filter(a => a != null && a !== '')
    : (agentName ? [agentName] : []);
  const hasAgent = agents.length > 0;

  // Selective cross-company scoping (2026-05-28): AVAILABLE bookings —
  // open carrier inventory not yet attached to a specific cargo — are
  // shared across all companies so any user can claim them. Every
  // other status (LOADED / DEPARTED / SHIPPED / CANCELLED) is the
  // exclusive workflow of the company that booked it and stays
  // company-scoped. PostgREST `.or()` lets us express this in one
  // round-trip: status=AVAILABLE OR companyId matches the current
  // company. When currentCompanyId is 'ALL' (admin / system scope),
  // skip the filter entirely.
  return useSupabaseQuery<Booking[]>(
    ['bookings', currentCompanyId, needle, agents.join('|')],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('bookings')
        .select('id, bookingNumber, customer, vesselVoyage, pol, pod, equipment, etd, eta, status, salesOrderId, createdAt, agentName, "freeTime", "cargoCutOff"')
        .order('createdAt', { ascending: false, nullsFirst: false })
        .limit(hasAgent ? 1000 : 200);  // widen the net when we'll filter client-side
      if (currentCompanyId !== 'ALL') {
        q = q.or(`status.eq.AVAILABLE,companyId.eq.${currentCompanyId}`);
      }
      if (needle) {
        q = q.or(`bookingNumber.ilike.*${needle}*,customer.ilike.*${needle}*,vesselVoyage.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const raw = ((data as unknown) as Raw[] | null) ?? [];
      const scoped = hasAgent
        ? raw.filter(r => matchesAnyAgent(r.agentName, agents))
        : raw;

      return scoped.map(r => ({
        id: r.id,
        bookingNumber: r.bookingNumber ?? r.id,
        customer: r.customer,
        vesselVoyage: r.vesselVoyage,
        pol: r.pol,
        pod: r.pod,
        equipment: r.equipment,
        etd: r.etd,
        eta: r.eta,
        status: r.status ?? 'AVAILABLE',
        salesOrderId: r.salesOrderId,
        agentName: r.agentName ?? null,
        freeTime: r.freeTime ?? null,
        transitDays: transitDaysBetween(r.etd, r.eta),
        cargoCutOff: r.cargoCutOff ?? null,
      }));
    },
  );
}
