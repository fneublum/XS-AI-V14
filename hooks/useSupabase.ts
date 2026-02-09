import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '../services/supabase';

export interface UseSupabaseOptions {
  select?: string;
  limit?: number;
  orderBy?: { column: string; ascending?: boolean };
}

export function useSupabase<T extends { id: string }>(
  tableName: string,
  options?: UseSupabaseOptions
) {
  // DEBUG: Log options for specific tables to trace 500 errors
  if (tableName === 'commission_sales_orders' || tableName === 'bookings') {
    console.log(`[useSupabase] Init ${tableName}`, { options, select: options?.select });
  }

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSchemaError, setHasSchemaError] = useState(false);

  const client = getSupabaseClient();
  const optionsKey = JSON.stringify(options);

  const fetchData = useCallback(async () => {
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

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data: dbData, error: dbError } = await query;

      // DEBUG: Log fetch results for bookings
      if (tableName === 'bookings') {
        console.log(`[useSupabase FETCH] ${tableName}: rows=${dbData?.length ?? 'null'}, error=${dbError ? dbError.message : 'none'}, code=${dbError ? (dbError as any).code : 'n/a'}`);
        if (dbData && dbData.length > 0) {
          console.log(`[useSupabase FETCH] ${tableName} first row:`, JSON.stringify(dbData[0]));
        }
        if (dbError) {
          console.error(`[useSupabase FETCH] ${tableName} FULL ERROR:`, JSON.stringify(dbError));
        }
      }

      if (dbError) throw dbError;

      setData((dbData as T[]) || []);
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

          // HACK: Sometimes a simple retry after a short delay works if it was a race condition
          // But usually this means columns are missing.

          // If we are in dev mode, we might want to alert the user clearly
          if (import.meta.env.DEV) {
            alert(`Database Schema Mismatch for table '${tableName}': ${msg}. \n\nPlease run the SQL update script provided in the assistant chat.`);
          }
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
      return newRecord;
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setError(`Insert failed: ${msg}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateRecord = async (record: T): Promise<T | null> => {
    setSaving(true);
    setError(null);
    const oldData = [...data];

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
      return updatedRecord;
    } catch (err: unknown) {
      setData(oldData); // Rollback
      const msg = (err as Error).message;
      setError(`Update failed: ${msg}`);
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

      return true;
    } catch (err: unknown) {
      setData(oldData); // Rollback
      const msg = (err as Error).message;
      setError(`Delete failed: ${msg}`);
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