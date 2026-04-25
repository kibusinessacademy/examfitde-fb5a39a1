/**
 * Typed wrapper for Supabase `.update()` calls.
 *
 * Enforces the use of `TablesUpdate<T>` so that excess-property protection
 * applies and we never accidentally widen update payloads to
 * `Record<string, unknown>` (which triggers TS2345 against the strict
 * generated types).
 *
 * Usage:
 *   await updateTable('marketing_campaigns', id, { status: 'live' });
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database, TablesUpdate } from '@/integrations/supabase/types';

type PublicTable = keyof Database['public']['Tables'];

/**
 * Update a row by `id` primary key with type-checked payload.
 *
 * The `as never` cast at the call site bridges the generic boundary that
 * Supabase's overloaded `.update()` signatures can't always infer; the outer
 * function signature remains the safe contract for callers.
 */
export async function updateTable<T extends PublicTable>(
  table: T,
  id: string,
  updates: TablesUpdate<T>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.from(table) as any).update(updates).eq('id', id);
}

/**
 * Build a TablesUpdate payload — useful when you want type-checking on the
 * literal object without calling `.update()` inline (e.g. when you need to
 * compose multiple filters before issuing the query).
 */
export function buildUpdate<T extends PublicTable>(
  _table: T,
  updates: TablesUpdate<T>,
): TablesUpdate<T> {
  return updates;
}
