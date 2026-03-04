/**
 * Schema Version Handshake – shared guard for all Edge Functions.
 *
 * Usage in any edge function:
 *   import { assertSchemaReady } from "../_shared/schema-gate.ts";
 *   await assertSchemaReady("my-function-name", supabaseServiceClient);
 *
 * Error types:
 *   SCHEMA_NOT_READY  – required_migration not yet deployed (deploy-order race)
 *   SCHEMA_DRIFT       – contracts vs actual DB mismatch (real inconsistency)
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export class SchemaNotReadyError extends Error {
  constructor(functionName: string, requiredMigration: string) {
    super(
      `SCHEMA_NOT_READY: ${functionName} requires migration "${requiredMigration}" but DB is not ready yet. Deploy DB first.`
    );
    this.name = "SchemaNotReadyError";
  }
}

export class SchemaDriftError extends Error {
  constructor(functionName: string, criticalCount: number) {
    super(
      `SCHEMA_DRIFT: ${functionName} detected ${criticalCount} critical drift(s) against contracts. Fix schema or update contracts.`
    );
    this.name = "SchemaDriftError";
  }
}

export async function assertSchemaReady(
  functionName: string,
  sb: SupabaseClient,
): Promise<void> {
  const { data, error } = await sb
    .from("schema_version_ledger")
    .select("required_migration, verified_ok, last_verified_at, verified_cycle, sync_cycle")
    .eq("function_name", functionName)
    .maybeSingle();

  // No ledger entry → function has no schema requirement (OK)
  if (!data || error) return;

  // Skip re-verification only if:
  // 1. verified_ok is true
  // 2. verified within last 15 min
  // 3. verified_cycle matches current sync_cycle (sync hasn't bumped)
  const FRESHNESS_MS = 15 * 60 * 1000;
  const isFresh =
    data.verified_ok &&
    data.last_verified_at &&
    new Date(data.last_verified_at).getTime() > Date.now() - FRESHNESS_MS &&
    (!data.sync_cycle || data.verified_cycle === data.sync_cycle);

  if (isFresh) return;

  // Run the drift check for this function's requirements
  const { data: drift } = await sb.rpc("check_schema_drift");
  const criticalCount = drift?.critical_count ?? 0;

  // Update verification timestamp + cycle
  const cycleId = new Date().toISOString().slice(0, 13); // hourly cycle e.g. "2026-02-24T09"
  await sb
    .from("schema_version_ledger")
    .update({
      last_verified_at: new Date().toISOString(),
      verified_ok: criticalCount === 0,
      verified_cycle: cycleId,
      updated_at: new Date().toISOString(),
    })
    .eq("function_name", functionName);

  if (criticalCount > 0) {
    // Distinguish: if drifts are "missing" entities → NOT_READY (deploy race)
    // If drifts are "wrong_type" or signature changes → DRIFT (real inconsistency)
    const drifts = drift?.drifts ?? [];
    const hasMissing = drifts.some(
      (d: any) => d.type === "missing_column" || d.type === "missing_rpc" || d.type === "missing_table"
    );
    const hasWrong = drifts.some(
      (d: any) => d.type === "wrong_type" || d.type === "wrong_signature"
    );

    if (hasMissing && !hasWrong) {
      throw new SchemaNotReadyError(functionName, data.required_migration);
    }
    throw new SchemaDriftError(functionName, criticalCount);
  }
}

/**
 * Lightweight version – just checks if a specific table+column exists.
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
