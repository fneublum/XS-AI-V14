/**
 * Activity Log Service — AI-Trainable Activity Logging
 * 
 * Captures all user interactions in a structured format optimized for:
 * - AI model training data extraction
 * - App improvement analysis
 * - Usage pattern detection
 * - Bug and friction identification
 * 
 * Features:
 * - Batched writes (flushes every 5s or 10 entries)
 * - Session management
 * - Field-level change detection for updates
 * - Console logging in dev mode
 * - JSONL export for AI training
 */

import { getSupabaseClient } from './supabase';

// ─── Enums ────────────────────────────────────────────────────────────────────

export type EventCategory = 'CRUD' | 'NAVIGATION' | 'AI_INTERACTION' | 'AUTH' | 'SYSTEM' | 'ERROR';

export type EventAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'READ'
  | 'PAGE_VIEW' | 'MODULE_SWITCH' | 'SUB_MODULE_SWITCH'
  | 'AI_QUERY' | 'AI_RESPONSE' | 'AI_ERROR'
  | 'LOGIN' | 'LOGOUT'
  | 'SEARCH' | 'FILTER' | 'EXPORT' | 'UPLOAD' | 'DOWNLOAD'
  | 'BUTTON_CLICK' | 'FORM_SUBMIT' | 'FORM_CANCEL'
  | 'ERROR' | 'WARNING';

export type ResultStatus = 'SUCCESS' | 'ERROR' | 'CANCELLED' | 'PENDING';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  session_id: string;
  user_id: string | null;
  user_role: string | null;
  company_id: string | null;
  event_category: EventCategory;
  event_action: EventAction;
  module: string | null;
  sub_module: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any>;
  duration_ms: number | null;
  error: string | null;
  result_status: ResultStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getSessionId(): string {
  let sid = sessionStorage.getItem('xs_activity_session_id');
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('xs_activity_session_id', sid);
  }
  return sid;
}

/**
 * Compute a diff between two objects, returning only changed fields.
 * Used for UPDATE logs to capture what actually changed.
 */
export function computeFieldDiff(
  oldRecord: Record<string, any>,
  newRecord: Record<string, any>
): { changed_fields: string[]; changes: Record<string, { from: any; to: any }> } {
  const changes: Record<string, { from: any; to: any }> = {};
  const changed_fields: string[] = [];

  for (const key of Object.keys(newRecord)) {
    if (key === 'id') continue; // Skip ID

    const oldVal = oldRecord[key];
    const newVal = newRecord[key];

    // Deep comparison for objects/arrays via JSON
    const oldStr = JSON.stringify(oldVal ?? null);
    const newStr = JSON.stringify(newVal ?? null);

    if (oldStr !== newStr) {
      changed_fields.push(key);
      // Truncate large values for the log (e.g., base64 documents)
      const truncate = (val: any) => {
        if (typeof val === 'string' && val.length > 200) {
          return val.substring(0, 200) + `...[${val.length} chars]`;
        }
        return val;
      };
      changes[key] = { from: truncate(oldVal), to: truncate(newVal) };
    }
  }

  return { changed_fields, changes };
}

/**
 * Extract a lightweight snapshot of a record for CREATE logs.
 * Removes large fields (base64, long text) to keep logs manageable.
 */
function createSnapshot(record: Record<string, any>): Record<string, any> {
  const snapshot: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 300) {
      snapshot[key] = `[${value.length} chars]`;
    } else if (value !== undefined && value !== null) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

// ─── ActivityLogger Singleton ─────────────────────────────────────────────────

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const IS_DEV = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

class ActivityLogger {
  private queue: ActivityLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private userRole: string | null = null;
  private companyId: string | null = null;
  private currentModule: string | null = null;
  private currentSubModule: string | null = null;
  private lastNavigationTime: number = Date.now();
  private isFlushing = false;

  constructor() {
    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush(true);
      });
    }
  }

  // ─── Context ──────────────────────────────────────────────────────────

  setUserContext(userId: string, userRole: string, companyId: string) {
    this.userId = userId;
    this.userRole = userRole;
    this.companyId = companyId;
  }

  setNavigationContext(module: string, subModule: string) {
    this.currentModule = module;
    this.currentSubModule = subModule;
  }

  clearContext() {
    this.userId = null;
    this.userRole = null;
    this.companyId = null;
    this.currentModule = null;
    this.currentSubModule = null;
  }

  // ─── Core Logging ─────────────────────────────────────────────────────

  private enqueue(entry: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'session_id' | 'user_id' | 'user_role' | 'company_id'>) {
    const fullEntry: ActivityLogEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      session_id: getSessionId(),
      user_id: this.userId,
      user_role: this.userRole,
      company_id: this.companyId,
      ...entry,
    };

    if (IS_DEV) {
      console.log(
        `[ActivityLog] ${fullEntry.event_category}.${fullEntry.event_action}`,
        fullEntry.entity_type ? `| ${fullEntry.entity_type}` : '',
        fullEntry.entity_id ? `#${fullEntry.entity_id.substring(0, 8)}` : '',
        fullEntry.details
      );
    }

    this.queue.push(fullEntry);

    if (this.queue.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  // ─── CRUD Logging ─────────────────────────────────────────────────────

  logCreate(entityType: string, record: Record<string, any>) {
    const fieldsSet = Object.keys(record).filter(k => record[k] !== undefined && record[k] !== null && record[k] !== '');
    this.enqueue({
      event_category: 'CRUD',
      event_action: 'CREATE',
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: entityType,
      entity_id: record.id || null,
      details: {
        fields_set: fieldsSet,
        field_count: fieldsSet.length,
        record_snapshot: createSnapshot(record),
      },
      duration_ms: null,
      error: null,
      result_status: 'SUCCESS',
    });
  }

  logUpdate(entityType: string, record: Record<string, any>, oldRecord: Record<string, any> | null) {
    const diff = oldRecord ? computeFieldDiff(oldRecord, record) : { changed_fields: Object.keys(record), changes: {} };
    this.enqueue({
      event_category: 'CRUD',
      event_action: 'UPDATE',
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: entityType,
      entity_id: record.id || null,
      details: diff,
      duration_ms: null,
      error: null,
      result_status: 'SUCCESS',
    });
  }

  logDelete(entityType: string, entityId: string) {
    this.enqueue({
      event_category: 'CRUD',
      event_action: 'DELETE',
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: entityType,
      entity_id: entityId,
      details: {},
      duration_ms: null,
      error: null,
      result_status: 'SUCCESS',
    });
  }

  logCrudError(action: EventAction, entityType: string, entityId: string | null, errorMsg: string) {
    this.enqueue({
      event_category: 'CRUD',
      event_action: action,
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: entityType,
      entity_id: entityId,
      details: {},
      duration_ms: null,
      error: errorMsg,
      result_status: 'ERROR',
    });
  }

  // ─── Navigation Logging ───────────────────────────────────────────────

  logNavigation(toModule: string, toSubModule: string = '') {
    const now = Date.now();
    const dwellTime = now - this.lastNavigationTime;

    this.enqueue({
      event_category: 'NAVIGATION',
      event_action: toSubModule ? 'SUB_MODULE_SWITCH' : 'MODULE_SWITCH',
      module: toModule,
      sub_module: toSubModule || null,
      entity_type: null,
      entity_id: null,
      details: {
        from_module: this.currentModule,
        from_sub_module: this.currentSubModule,
        to_module: toModule,
        to_sub_module: toSubModule,
        time_on_previous_page_ms: dwellTime,
      },
      duration_ms: dwellTime,
      error: null,
      result_status: 'SUCCESS',
    });

    this.lastNavigationTime = now;
    this.currentModule = toModule;
    this.currentSubModule = toSubModule;
  }

  // ─── Auth Logging ─────────────────────────────────────────────────────

  logAuth(action: 'LOGIN' | 'LOGOUT', userDetails?: { id: string; name: string; role: string }) {
    this.enqueue({
      event_category: 'AUTH',
      event_action: action,
      module: null,
      sub_module: null,
      entity_type: 'user',
      entity_id: userDetails?.id || this.userId,
      details: userDetails ? {
        user_name: userDetails.name,
        user_role: userDetails.role,
        login_time: new Date().toISOString(),
      } : {},
      duration_ms: null,
      error: null,
      result_status: 'SUCCESS',
    });
  }

  // ─── AI Interaction Logging ───────────────────────────────────────────

  logAiInteraction(params: {
    aiService: string;
    agentType: string;
    userPrompt: string;
    responseLength?: number;
    responseTimeMs?: number;
    toolsUsed?: string[];
    error?: string;
  }) {
    this.enqueue({
      event_category: 'AI_INTERACTION',
      event_action: params.error ? 'AI_ERROR' : 'AI_QUERY',
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: null,
      entity_id: null,
      details: {
        ai_service: params.aiService,
        agent_type: params.agentType,
        user_prompt: params.userPrompt.length > 500
          ? params.userPrompt.substring(0, 500) + '...'
          : params.userPrompt,
        response_length: params.responseLength || 0,
        response_time_ms: params.responseTimeMs || 0,
        tools_used: params.toolsUsed || [],
      },
      duration_ms: params.responseTimeMs || null,
      error: params.error || null,
      result_status: params.error ? 'ERROR' : 'SUCCESS',
    });
  }

  // ─── System / Error Logging ───────────────────────────────────────────

  logError(errorMsg: string, context?: Record<string, any>) {
    this.enqueue({
      event_category: 'ERROR',
      event_action: 'ERROR',
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: null,
      entity_id: null,
      details: context || {},
      duration_ms: null,
      error: errorMsg,
      result_status: 'ERROR',
    });
  }

  logSystem(action: EventAction, details?: Record<string, any>) {
    this.enqueue({
      event_category: 'SYSTEM',
      event_action: action,
      module: this.currentModule,
      sub_module: this.currentSubModule,
      entity_type: null,
      entity_id: null,
      details: details || {},
      duration_ms: null,
      error: null,
      result_status: 'SUCCESS',
    });
  }

  // ─── Flush / Write ────────────────────────────────────────────────────

  async flush(sync = false) {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const batch = this.queue.splice(0, this.queue.length);

    try {
      const client = getSupabaseClient();

      if (sync && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        // Fire-and-forget insert for page unload scenario
        (async () => { try { await client.from('activity_logs').insert(batch); } catch { } })();
      } else {
        const { error } = await client.from('activity_logs').insert(batch);
        if (error) {
          console.error('[ActivityLog] Flush error:', error.message);
          // Re-queue failed entries (up to limit to prevent infinite growth)
          if (this.queue.length < 100) {
            this.queue.push(...batch);
          }
        }
      }
    } catch (err) {
      console.error('[ActivityLog] Flush exception:', err);
      if (this.queue.length < 100) {
        this.queue.push(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  // ─── Training Data Export ─────────────────────────────────────────────

  /**
   * Export activity logs as JSONL (one JSON object per line).
   * Ready for AI model fine-tuning.
   * 
   * Call from browser console: activityLogger.exportTrainingData()
   */
  async exportTrainingData(options?: {
    fromDate?: string;
    toDate?: string;
    categories?: EventCategory[];
    limit?: number;
  }): Promise<string> {
    const client = getSupabaseClient();

    let query = client
      .from('activity_logs')
      .select('*')
      .order('timestamp', { ascending: true });

    if (options?.fromDate) {
      query = query.gte('timestamp', options.fromDate);
    }
    if (options?.toDate) {
      query = query.lte('timestamp', options.toDate);
    }
    if (options?.categories && options.categories.length > 0) {
      query = query.in('event_category', options.categories);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    } else {
      query = query.limit(5000);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[ActivityLog] Export error:', error.message);
      return '';
    }

    // Convert to JSONL
    const jsonl = (data || []).map(row => JSON.stringify(row)).join('\n');

    // Also trigger download
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity_logs_${new Date().toISOString().split('T')[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[ActivityLog] Exported ${(data || []).length} entries as JSONL`);
    return jsonl;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  /**
   * Delete logs older than the specified number of days.
   * Default: 90 days. Call periodically or from admin settings.
   */
  async cleanup(olderThanDays = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('activity_logs')
      .delete()
      .lt('timestamp', cutoff.toISOString())
      .select('id');

    if (error) {
      console.error('[ActivityLog] Cleanup error:', error.message);
      return 0;
    }

    const count = (data || []).length;
    console.log(`[ActivityLog] Cleaned up ${count} entries older than ${olderThanDays} days`);
    return count;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush(true);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const activityLogger = new ActivityLogger();

// Make available in browser console for debugging / export
if (typeof window !== 'undefined') {
  (window as any).activityLogger = activityLogger;
}
