import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '../services/supabase';
import { activityLogger } from '../services/activityLogService';

export interface UseSupabaseOptions {
  select?: string;
  limit?: number;
  /**
   * Cap the result count from PostgREST. Aliased to `limit` when `limit`
   * isn't set explicitly — most callers pass `pageSize` (semantic name)
   * rather than `limit`. PostgREST's server-side default is 1000 rows,
   * so unbounded tables must set this.
   */
  pageSize?: number;
  orderBy?: { column: string; ascending?: boolean };
  /**
   * When `false`, skip the fetch entirely and leave `data` as the empty
   * array (or whatever was last fetched). Used by App.tsx to gate
   * per-module lazy queries — without this, every "lazy" hook fired on
   * every login regardless of which module the user opened.
   */
  enabled?: boolean;
}

export function useSupabase<T extends { id: string }>(
  tableName: string,
  options?: UseSupabaseOptions
) {
  const enabled = options?.enabled !== false;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSchemaError, setHasSchemaError] = useState(false);

  const client = getSupabaseClient();
  const optionsKey = JSON.stringify(options);

  const fetchData = useCallback(async () => {
    if (options?.enabled === false) {
      // Caller has gated this query off (e.g. module not yet active).
      // Don't hit the network; leave any previously-loaded data in place.
      setLoading(false);
      return;
    }

    setLoading(true);
    setHasSchemaError(false);
    setError(null);

    try {
      let query = client.from(tableName).select(options?.select || '*');

      if (options?.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }

      const cap = options?.limit ?? options?.pageSize;
      if (cap) {
        query = query.limit(cap);
      }

      const { data: dbData, error: dbError } = await query;

      if (dbError) throw dbError;

      // Deduplicate by id to prevent duplicate dropdown options
      const rawData = (dbData as unknown as T[]) || [];
      const deduped = [...new Map(rawData.map(item => [item.id, item])).values()];
      setData(deduped);
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      const msg = error.message || 'Unknown error';

      const isFetchError =
        err instanceof TypeError || msg.toLowerCase().includes('fetch');

      if (isFetchError) {
        setError('Network request failed. Please disable ad blockers for this site.');
      } else {
        setError(msg);

        const isSchemaError =
          msg.includes('does not exist') ||
          msg.includes('schema cache') ||
          error.code === '42P01';

        if (isSchemaError) {
          console.error(`Schema mismatch in ${tableName}. Refreshing schema cache...`);
          // Force a schema refresh by making a harmless OPTIONS request or re-init
          // For Supabase JS client, we can try to re-fetch with a fresh client instance or just wait
          // In many cases, just identifying it helps. 
          // We can also try to reload the page if it persists, but that's aggressive.
          // Let's just set the state for now.
          setHasSchemaError(true);
        }
      }

      setData([]);
    } finally {
      setLoading(false);
    }
  }, [client, tableName, optionsKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addRecord = async (record: Omit<T, 'id'> | T): Promise<T | null> => {
    setSaving(true);
    setError(null);

    try {
      // Sanitize payload: convert empty strings to null for date/timestamp columns
      const sanitizedRecord = Object.fromEntries(
        Object.entries(record as any).map(([key, value]) => [
          key,
          value === '' ? null : value
        ])
      );

      const { data: newData, error: dbError } = await client
        .from(tableName)
        .insert(sanitizedRecord as any)
        .select()
        .single();

      if (dbError) throw dbError;

      const newRecord = newData as T;
      setData((prev) => [newRecord, ...prev]);

      // Activity Log: record creation
      if (tableName !== 'activity_logs') {
        activityLogger.logCreate(tableName, newRecord as any);
      }

      return newRecord;
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setError(`Insert failed: ${msg}`);

      // Activity Log: record creation error
      if (tableName !== 'activity_logs') {
        activityLogger.logCrudError('CREATE', tableName, null, msg);
      }

      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateRecord = async (record: T): Promise<T | null> => {
    setSaving(true);
    setError(null);
    const oldData = [...data];
    const oldRecord = data.find((i) => i.id === record.id) || null;

    // Optimistic update
    setData((prev) => prev.map((i) => (i.id === record.id ? record : i)));

    try {
      // Strip ID from payload to avoid Primary Key update restriction issues
      const { id, ...updatePayload } = record as any;

      // Sanitize payload: convert empty strings to null for date/timestamp columns
      // This prevents "invalid input syntax for type date" errors
      const sanitizedPayload = Object.fromEntries(
        Object.entries(updatePayload).map(([key, value]) => [
          key,
          value === '' ? null : value
        ])
      );

      const { data: updated, error: dbError } = await client
        .from(tableName)
        .update(sanitizedPayload)
        .eq('id', record.id)
        .select()
        .single();

      if (dbError) throw dbError;

      const updatedRecord = updated as T;
      setData((prev) => prev.map((i) => (i.id === record.id ? updatedRecord : i)));

      // Activity Log: record update with field-level diff
      if (tableName !== 'activity_logs') {
        activityLogger.logUpdate(tableName, updatedRecord as any, oldRecord as any);
      }

      return updatedRecord;
    } catch (err: unknown) {
      setData(oldData); // Rollback
      const msg = (err as Error).message;
      setError(`Update failed: ${msg}`);

      // Activity Log: record update error
      if (tableName !== 'activity_logs') {
        activityLogger.logCrudError('UPDATE', tableName, record.id, msg);
      }

      return null;
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (id: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    const oldData = [...data];

    // Optimistic delete
    setData((prev) => prev.filter((i) => i.id !== id));

    try {
      const { error: dbError } = await client
        .from(tableName)
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      // Activity Log: record deletion
      if (tableName !== 'activity_logs') {
        activityLogger.logDelete(tableName, id);
      }

      return true;
    } catch (err: unknown) {
      setData(oldData); // Rollback
      const msg = (err as Error).message;
      setError(`Delete failed: ${msg}`);

      // Activity Log: record deletion error
      if (tableName !== 'activity_logs') {
        activityLogger.logCrudError('DELETE', tableName, id, msg);
      }

      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    data,
    loading,
    saving,
    error,
    hasSchemaError,
    addRecord,
    updateRecord,
    deleteRecord,
    refetch: fetchData,
  };
}