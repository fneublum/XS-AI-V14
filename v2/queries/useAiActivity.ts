// Phase 3B — AI-activity feed from activity_logs.

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface ActivityEvent {
  id: string;
  timestamp: string;
  module: string | null;
  subModule: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  resultStatus: string;
  durationMs: number | null;
}

interface Raw {
  id: string;
  timestamp: string;
  module: string | null;
  sub_module: string | null;
  event_category: string | null;
  event_action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  result_status: string | null;
  duration_ms: number | null;
}

export function useAiActivity(module?: string, limit = 8) {
  return useSupabaseQuery<ActivityEvent[]>(
    ['aiActivity', module ?? 'all', limit],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('activity_logs')
        .select('id, timestamp, module, sub_module, event_category, event_action, entity_type, entity_id, result_status, duration_ms')
        .order('timestamp', { ascending: false })
        .limit(limit);
      if (module) q = q.eq('module', module);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        module: r.module,
        subModule: r.sub_module,
        action: `${r.event_category ?? ''}.${r.event_action ?? ''}`.replace(/^\./, ''),
        entityType: r.entity_type,
        entityId: r.entity_id,
        resultStatus: r.result_status ?? 'SUCCESS',
        durationMs: r.duration_ms,
      }));
    },
  );
}
