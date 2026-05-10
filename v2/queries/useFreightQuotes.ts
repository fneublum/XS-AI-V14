// Phase 3B — Freight quotes query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface FreightQuote {
  id: string;
  agentName: string | null;
  carrier: string | null;
  freightType: string | null;
  originPort: string | null;
  destinationPort: string | null;
  originPortCode: string | null;
  destinationPortCode: string | null;
  rate: number | null;
  currency: string;
  validUntil: string | null;
  freeTime: number | null;
  transitTime: number | null;
  status: string;
  // Location — pickup/delivery zip + free-text location notes. The
  // source ports table already covers POA/POD; these keep per-quote
  // pickup/delivery specifics.
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupZip: string | null;
  deliveryZip: string | null;
  pickupCity: string | null;
  pickupCountry: string | null;
  // Equipment — container count/type + demurrage/release windows.
  containerCount: number | null;
  containerType: string | null;
  containerReturn: string | null;
  blRelease: string | null;
  // Cost breakdown — the quote rate is usually an all-in figure but
  // the agent often itemises; expose every known fee column so the
  // editor can show the breakdown without the UI losing data on save.
  pickupCost: number | null;
  oceanCost: number | null;
  deliveryCost: number | null;
  portFees: number | null;
  securityFee: number | null;
  deconsolidation: number | null;
  thc: number | null;
  isps: number | null;
  trs: number | null;
  bunkerSurcharge: number | null;
  exwCharges: number | null;
  // Flags — booleans stored as bool columns in PG; surface as native
  // bool and let the drawer render a select. `isAllIn` toggles whether
  // the cost breakdown rolls up into the rate or is itemised.
  chassis: boolean | null;
  overweight: boolean | null;
  isAllIn: boolean | null;
  // Notes — free-text columns.
  comments: string | null;
  observation: string | null;
}

// The `freight_quotes` table is snake_case end-to-end (company_id,
// valid_until, agent_name, freight_type, transit_time, destination_port).
// That's why both filter and select use snake_case column names here,
// unlike the rest of the v2 queries that hit camelCase tables. A few
// rows in the wild carry both snake_case and camelCase duplicates
// (`container_return` vs `containerReturn`) from earlier schema churn;
// we prefer snake_case and fall back to the camelCase twin on read.
interface Raw {
  id: string;
  agent_name: string | null;
  carrier: string | null;
  freight_type: string | null;
  origin_port: string | null;
  destination_port: string | null;
  origin_port_code: string | null;
  destination_port_code: string | null;
  rate: number | string | null;
  currency: string | null;
  valid_until: string | null;
  free_time: number | string | null;
  transit_time: number | string | null;
  status: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  pickup_zip: string | null;
  delivery_zip: string | null;
  pickupCity: string | null;
  pickupCountry: string | null;
  container_count: number | string | null;
  container_type: string | null;
  container_return: string | null;
  containerReturn: string | null;
  bl_release: string | null;
  blRelease: string | null;
  pickup_cost: number | string | null;
  ocean_cost: number | string | null;
  delivery_cost: number | string | null;
  port_fees: number | string | null;
  security_fee: number | string | null;
  securityFee: number | string | null;
  deconsolidation: number | string | null;
  thc: number | string | null;
  isps: number | string | null;
  trs: number | string | null;
  bunker_surcharge: number | string | null;
  exw_charges: number | string | null;
  chassis: boolean | null;
  overweight: boolean | null;
  is_all_in: boolean | null;
  comments: string | null;
  observation: string | null;
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('company_id', companyId) as Q);
}

/**
 * agentName can be a single string or an array — when the logged-in
 * user is linked to multiple cargo_agents rows (see AuthProvider) the
 * Agent Portal passes every linked agent name so the UI shows the
 * union. Whitespace preserved verbatim (cargo_agents.name can have
 * trailing spaces like "KAPPALOG ").
 */
export function useFreightQuotes(search?: string, agentName?: string | string[]) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';
  const agents = Array.isArray(agentName)
    ? agentName.filter(a => a != null && a !== '')
    : (agentName ? [agentName] : []);

  return useSupabaseQuery<FreightQuote[]>(
    ['freightQuotes', currentCompanyId, needle, agents.join('|')],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('freight_quotes')
          .select('*')
          .order('valid_until', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (agents.length === 1) {
        q = q.ilike('agent_name', agents[0]) as typeof q;
      } else if (agents.length > 1) {
        const clauses = agents
          .map(a => `agent_name.ilike.${String(a).replace(/,/g, '')}`)
          .join(',');
        q = q.or(clauses) as typeof q;
      }
      if (needle) {
        q = q.or(
          `agent_name.ilike.*${needle}*,carrier.ilike.*${needle}*,` +
          `origin_port.ilike.*${needle}*,destination_port.ilike.*${needle}*,` +
          `origin_port_code.ilike.*${needle}*,destination_port_code.ilike.*${needle}*`,
        ) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        agentName: r.agent_name,
        carrier: r.carrier,
        freightType: r.freight_type,
        originPort: r.origin_port,
        destinationPort: r.destination_port,
        originPortCode: r.origin_port_code,
        destinationPortCode: r.destination_port_code,
        rate: num(r.rate),
        currency: r.currency ?? 'USD',
        validUntil: r.valid_until,
        freeTime: num(r.free_time),
        transitTime: num(r.transit_time),
        status: r.status ?? 'ACTIVE',
        pickupLocation: r.pickup_location,
        deliveryLocation: r.delivery_location,
        pickupZip: r.pickup_zip,
        deliveryZip: r.delivery_zip,
        pickupCity: r.pickupCity,
        pickupCountry: r.pickupCountry,
        containerCount: num(r.container_count),
        containerType: r.container_type,
        // Prefer snake_case; fall back to the camelCase duplicate seen
        // on older rows. Legacy rows keep both in sync after a save.
        containerReturn: r.container_return ?? r.containerReturn ?? null,
        blRelease:       r.bl_release       ?? r.blRelease       ?? null,
        pickupCost:      num(r.pickup_cost),
        oceanCost:       num(r.ocean_cost),
        deliveryCost:    num(r.delivery_cost),
        portFees:        num(r.port_fees),
        securityFee:     num(r.security_fee ?? r.securityFee),
        deconsolidation: num(r.deconsolidation),
        thc:             num(r.thc),
        isps:            num(r.isps),
        trs:             num(r.trs),
        bunkerSurcharge: num(r.bunker_surcharge),
        exwCharges:      num(r.exw_charges),
        chassis:    r.chassis,
        overweight: r.overweight,
        isAllIn:    r.is_all_in,
        comments:   r.comments,
        observation: r.observation,
      }));
    },
  );
}
