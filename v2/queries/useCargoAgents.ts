// Cargo agents — shipping agents / freight forwarders. Referenced
// from the `users.linked_entity_id` column so a 'Cargo Agent' role
// user can be scoped to "their" quotes and bookings in the portal.

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface CargoAgent {
  id: string;
  name: string;
}

export function useCargoAgents() {
  return useSupabaseQuery<CargoAgent[]>(
    ['cargo_agents'],
    async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('cargo_agents')
        .select('id, name')
        .order('name')
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data as Array<Partial<CargoAgent>> | null) ?? []).map(r => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? '').trim(),
      })).filter(r => r.id);
    },
  );
}
