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
 *   // → builder; chain `.eq()` / `.in()` / `.match()` as needed (already applied to id)
 *
 * Or for custom filters:
 *   await updateTableBy('marketing_campaigns',
 *     { status: 'live' },
 *     (q) => q.eq('user_id', uid).in('status', ['draft', 'scheduled']));
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database, TablesUpdate } from '@/integrations/supabase/types';

type PublicTable = keyof Database['public']['Tables'];

/**
 * Update a row by primary key (`id`). Returns the awaited Supabase result.
 */
export async function updateTable<T extends PublicTable>(
  table: T,
  id: string,
  updates: TablesUpdate<T>,
) {
  // Cast through `never` is intentional: Supabase's generic .update() requires
  // the literal table-shape, but TypeScript can't always infer it across the
  // generic boundary. The outer signature is the safe contract.
  return supabase
    .from(table)
    .update(updates as never)
    .eq('id', id);
}

/**
 * Update with a custom filter callback. Useful for compound filters.
 */
export function updateTableBy<T extends PublicTable>(
  table: T,
  updates: TablesUpdate<T>,
  filter: (
    builder: ReturnType<typeof supabase.from<T>>['update'] extends (
      ...args: infer _A
    ) => infer R
      ? R
      : never,
  ) => unknown,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (supabase.from(table) as any).update(updates);
  return filter(builder);
}

/**
 * Build a TablesUpdate payload — useful when you want type-checking on the
 * literal object without having to call .update() inline.
 *
 * Example:
 *   const patch = buildUpdate('marketing_campaigns', { status: 'live' });
 */
export function buildUpdate<T extends PublicTable>(
  _table: T,
  updates: TablesUpdate<T>,
): TablesUpdate<T> {
  return updates;
}
