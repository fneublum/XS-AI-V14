// Unified recipient resolver.
//
// Single source of truth for who gets To/Cc/Bcc when any document
// (sales order, proforma, invoice, delivery docs, PO, SOPICI) is
// emailed. Before this existed the same logic was copy-pasted across
// five call sites and drifted — email2/email3 support, consignee vs
// notify split, and cargo-agent-from-booking each had to be applied
// in 3+ places per change.
//
// Call sites pass *actors* (a customer or supplier reference, plus a
// role), plus optional booking / broker flags. The resolver reads the
// already-loaded customer and supplier lists from the caller and
// (when asked) hits Supabase once for cargo-agent emails.

import { getSupabaseClient } from '../../services/supabase';

// Structural subsets — so legacy v1 pages (types.ts) can pass their
// own Customer/Supplier shapes without adapters.
export interface CustomerLike {
  id: string;
  name: string | null;
  email?: string | null;
  email2?: string | null;
  email3?: string | null;
  brokerEmail?: string | null;
}
export interface SupplierLike {
  id: string;
  name: string | null;
  email?: string | null;
}

export interface Recipients {
  to: string[];
  cc: string[];
  bcc: string[];
  audit: {
    matchedCustomerIds: string[];
    matchedSupplierIds: string[];
    unmatched: string[];
    cargoAgentName: string | null;
    cargoAgentEmails: string[];
  };
}

export interface RecipientActor {
  customerId?: string | null;
  customerName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  /**
   * `primary` (default) → contact's main email goes to TO, secondary
   * emails (email2/email3/broker) go to CC. `secondary` → same as
   * primary today, but reserved for entities that should CC-only the
   * main email in the future. `cc-only` → all emails go to CC.
   */
  role?: 'primary' | 'secondary' | 'cc-only';
}

export interface ResolveOptions {
  actors: RecipientActor[];
  /** If set, look up cargo_agents by booking.agentName and CC the agent. */
  bookingNumber?: string | null;
  /** CC each matched customer's brokerEmail. */
  includeBroker?: boolean;
  /**
   * Brazil-mode restricts TO to the *first* primary actor only (keeps
   * CC behavior intact). Matches the legacy PLInvoiceEngine BR branch.
   */
  brMode?: boolean;
  /** Already-loaded customer list from the caller (no extra fetch). */
  customers: CustomerLike[];
  /** Already-loaded supplier list. Required if any actor is a supplier. */
  suppliers?: SupplierLike[];
  /** Static CCs appended verbatim (e.g. felipe@ec4.enterprises). */
  extraCc?: string[];
}

const EMAIL_RE = /\S+@\S+\.\S+/;

const pushEmail = (set: Set<string>, raw: string | null | undefined): void => {
  if (!raw) return;
  raw.split(/[;,]\s*/).forEach(piece => {
    const e = piece.trim();
    if (e && EMAIL_RE.test(e)) set.add(e);
  });
};

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

const findCustomer = (actor: RecipientActor, customers: CustomerLike[]): CustomerLike | null => {
  if (actor.customerId) {
    const byId = customers.find(c => c.id === actor.customerId);
    if (byId) return byId;
  }
  if (actor.customerName) {
    const target = norm(actor.customerName);
    if (!target) return null;
    const byExact = customers.find(c => norm(c.name) === target);
    if (byExact) return byExact;
    const byContains = customers.find(c => {
      const n = norm(c.name);
      return n !== '' && (n.includes(target) || target.includes(n));
    });
    if (byContains) return byContains;
  }
  return null;
};

const findSupplier = (actor: RecipientActor, suppliers: SupplierLike[]): SupplierLike | null => {
  if (actor.supplierId) {
    const byId = suppliers.find(s => s.id === actor.supplierId);
    if (byId) return byId;
  }
  if (actor.supplierName) {
    const target = norm(actor.supplierName);
    if (!target) return null;
    const byExact = suppliers.find(s => norm(s.name) === target);
    if (byExact) return byExact;
  }
  return null;
};

// Parsing cargo-agent names like "INFINITY/HUSKLOG/KAPPALOG" into
// probe-keywords. Must stay in sync with useBookings.matchesAnyAgent.
const AGENT_SKIP = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'solutions', 'logistics',
  'shipping', 'the', 'and', 'of', 'sa', 'sas', 'srl', 'gmbh',
]);

const cargoAgentKeywords = (agentName: string | null | undefined): string[] => {
  if (!agentName) return [];
  return agentName
    .split(/[\s/,·&|+]+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !AGENT_SKIP.has(w.toLowerCase()));
};

async function lookupCargoAgentEmails(
  bookingNumber: string,
): Promise<{ emails: string[]; agentName: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data: bookings } = await supabase
      .from('bookings')
      .select('agentName')
      .eq('bookingNumber', bookingNumber)
      .limit(1);
    const agentName = (bookings?.[0]?.agentName as string | undefined) ?? null;
    if (!agentName) return { emails: [], agentName: null };

    const keywords = cargoAgentKeywords(agentName);
    if (keywords.length === 0) return { emails: [], agentName };

    for (const kw of keywords) {
      const { data } = await supabase
        .from('cargo_agents')
        .select('email,email2')
        .ilike('name', `%${kw}%`)
        .limit(1);
      const row = data?.[0] as { email?: string | null; email2?: string | null } | undefined;
      if (row) {
        const emails: string[] = [];
        if (row.email) emails.push(row.email);
        if (row.email2) emails.push(row.email2);
        return { emails, agentName };
      }
    }
    return { emails: [], agentName };
  } catch (e) {
    console.warn('[recipients] cargo-agent lookup failed:', e);
    return { emails: [], agentName: null };
  }
}

function buildFromActors(
  opts: ResolveOptions,
): { to: Set<string>; cc: Set<string>; matchedCustomerIds: Set<string>; matchedSupplierIds: Set<string>; unmatched: string[] } {
  const to = new Set<string>();
  const cc = new Set<string>();
  const matchedCustomerIds = new Set<string>();
  const matchedSupplierIds = new Set<string>();
  const unmatched: string[] = [];

  // BR mode: only the first primary actor contributes; all of its
  // contact emails (email+email2+email3) land on TO; broker and
  // cargo-agent go to CC. Matches legacy PLInvoiceEngine BR branch.
  if (opts.brMode) {
    const firstPrimaryActor = opts.actors.find(a => (a.role ?? 'primary') === 'primary');
    if (firstPrimaryActor) {
      if (firstPrimaryActor.supplierId || firstPrimaryActor.supplierName) {
        const sup = opts.suppliers ? findSupplier(firstPrimaryActor, opts.suppliers) : null;
        if (sup) {
          matchedSupplierIds.add(sup.id);
          pushEmail(to, sup.email);
        }
      } else {
        const cust = findCustomer(firstPrimaryActor, opts.customers);
        if (cust) {
          matchedCustomerIds.add(cust.id);
          pushEmail(to, cust.email);
          pushEmail(to, cust.email2);
          pushEmail(to, cust.email3);
          if (opts.includeBroker) pushEmail(cc, cust.brokerEmail);
        } else if (firstPrimaryActor.customerName) {
          unmatched.push(firstPrimaryActor.customerName);
        }
      }
    }
    return { to, cc, matchedCustomerIds, matchedSupplierIds, unmatched };
  }

  for (const actor of opts.actors) {
    const role = actor.role ?? 'primary';

    if (actor.supplierId || actor.supplierName) {
      const sup = opts.suppliers ? findSupplier(actor, opts.suppliers) : null;
      if (sup) {
        matchedSupplierIds.add(sup.id);
        if (role === 'cc-only') pushEmail(cc, sup.email);
        else pushEmail(to, sup.email);
      } else if (actor.supplierName) {
        unmatched.push(actor.supplierName);
      }
      continue;
    }

    const cust = findCustomer(actor, opts.customers);
    if (!cust) {
      if (actor.customerName) unmatched.push(actor.customerName);
      continue;
    }
    matchedCustomerIds.add(cust.id);

    if (role === 'cc-only') pushEmail(cc, cust.email);
    else pushEmail(to, cust.email);

    pushEmail(cc, cust.email2);
    pushEmail(cc, cust.email3);
    if (opts.includeBroker) pushEmail(cc, cust.brokerEmail);
  }

  return { to, cc, matchedCustomerIds, matchedSupplierIds, unmatched };
}

/**
 * Full resolver — pass a booking number to also CC the cargo agent.
 * Hits Supabase at most once for the agent lookup; safe to ignore the
 * `audit` field if you don't need a recipient trace.
 */
export async function resolveRecipients(opts: ResolveOptions): Promise<Recipients> {
  const base = buildFromActors(opts);
  let cargoAgentName: string | null = null;
  let cargoAgentEmails: string[] = [];

  if (opts.bookingNumber) {
    const res = await lookupCargoAgentEmails(opts.bookingNumber);
    cargoAgentName = res.agentName;
    cargoAgentEmails = res.emails;
    res.emails.forEach(e => pushEmail(base.cc, e));
  }

  if (opts.extraCc) opts.extraCc.forEach(e => pushEmail(base.cc, e));

  for (const e of Array.from(base.cc)) {
    if (base.to.has(e)) base.cc.delete(e);
  }

  return {
    to: Array.from(base.to),
    cc: Array.from(base.cc),
    bcc: [],
    audit: {
      matchedCustomerIds: Array.from(base.matchedCustomerIds),
      matchedSupplierIds: Array.from(base.matchedSupplierIds),
      unmatched: base.unmatched,
      cargoAgentName,
      cargoAgentEmails,
    },
  };
}

/**
 * Sync variant for call sites that don't need cargo-agent lookup
 * (e.g. Sales Order / PO / simple Proforma). No DB hit.
 */
export function resolveRecipientsSync(
  opts: Omit<ResolveOptions, 'bookingNumber'>,
): Recipients {
  const base = buildFromActors(opts);
  if (opts.extraCc) opts.extraCc.forEach(e => pushEmail(base.cc, e));
  for (const e of Array.from(base.cc)) {
    if (base.to.has(e)) base.cc.delete(e);
  }
  return {
    to: Array.from(base.to),
    cc: Array.from(base.cc),
    bcc: [],
    audit: {
      matchedCustomerIds: Array.from(base.matchedCustomerIds),
      matchedSupplierIds: Array.from(base.matchedSupplierIds),
      unmatched: base.unmatched,
      cargoAgentName: null,
      cargoAgentEmails: [],
    },
  };
}

/**
 * Helper for drawers that still use legacy "to: string; cc: string"
 * draft shapes (semicolon-joined). Convert a Recipients result.
 */
export const joinRecipients = (r: Recipients): { to: string; cc: string } => ({
  to: r.to.join('; '),
  cc: r.cc.join('; '),
});
