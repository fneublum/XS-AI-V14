// Cargo agents — shipping agents / freight forwarders. Referenced
// from the `users.linked_entity_id` column so a 'Cargo Agent' role
// user can be scoped to "their" quotes and bookings in the portal.

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface CargoAgent {
  id: string;
  name: string;
  /** Primary contact email — used as "To" in RFQ email sends. */
  email: string | null;
  /** Optional secondary email — added to CC when present. */
  email2: string | null;
  country: string | null;
}

interface RawAgent {
  id: string | null;
  name: string | null;
  email: string | null;
  email2: string | null;
  country: string | null;
}

export function useCargoAgents() {
  return useSupabaseQuery<CargoAgent[]>(
    ['cargo_agents'],
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('cargo_agents')
        .select('id, name, email, email2, country')
        .order('name')
        .limit(500);
      if (error) throw new Error(error.message);
      // Keep `name` exact (including trailing whitespace) so when other
      // code writes `freight_quotes.agent_name` from this value, it
      // matches the value stored on the cargo_agents row. Several rows
      // in the wild have stray trailing spaces (e.g. "KAPPALOG ") that
      // the Agent Portal lookup also preserves; trimming here would
      // hide those rows from the agent's portal view. UI-side display
      // can trim at the render site.
      return ((data as RawAgent[] | null) ?? []).map(r => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        email: r.email && String(r.email).trim() ? String(r.email).trim() : null,
        email2: r.email2 && String(r.email2).trim() ? String(r.email2).trim() : null,
        country: r.country && String(r.country).trim() ? String(r.country).trim() : null,
      })).filter(r => r.id);
    },
  );
}
