/**
 * Schema Version Handshake – shared guard for all Edge Functions.
 *
 * Usage in any edge function:
 *   import { assertSchemaReady } from "../_shared/schema-gate.ts";
 *   await assertSchemaReady("my-function-name", supabaseServiceClient);
 *
 * If the DB schema hasn't reached the required migration the function
 * returns a clear 503 error instead of crashing with cryptic column errors.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export async function assertSchemaReady(
  functionName: string,
  sb: SupabaseClient,
): Promise<void> {
  const { data, error } = await sb
    .from("schema_version_ledger")
    .select("required_migration, verified_ok")
    .eq("function_name", functionName)
    .maybeSingle();

  // No ledger entry → function has no schema requirement (OK)
  if (!data || error) return;

  if (data.verified_ok) return; // already verified this cycle

  // Run the drift check for this function's requirements
  const { data: drift } = await sb.rpc("check_schema_drift");
  const criticalCount = drift?.critical_count ?? 0;

  // Update verification timestamp
  await sb
    .from("schema_version_ledger")
    .update({
      last_verified_at: new Date().toISOString(),
      verified_ok: criticalCount === 0,
      updated_at: new Date().toISOString(),
    })
    .eq("function_name", functionName);

  if (criticalCount > 0) {
    throw new Error(
      `SCHEMA_DRIFT: ${functionName} requires migration "${data.required_migration}" ` +
      `but ${criticalCount} critical drift(s) detected. Deploy blocked.`
    );
  }
}

/**
 * Lightweight version – just checks if a specific table+column exists.
 * Use when you don't want the full drift scan overhead.
 */
export async function assertColumnExists(
  sb: SupabaseClient,
  table: string,
  column: string,
): Promise<void> {
  const { data } = await sb.rpc("check_schema_drift");
  const drifts = data?.drifts ?? [];
  const match = drifts.find(
    (d: any) => d.entity === `${table}.${column}` && d.type === "missing_column"
  );
  if (match) {
    throw new Error(`SCHEMA_DRIFT: Column ${table}.${column} is missing in DB`);
  }
}
