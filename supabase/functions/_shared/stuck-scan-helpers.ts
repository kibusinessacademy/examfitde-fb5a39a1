/**
 * stuck-scan shared helpers: utility functions, types, and constants.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export type SupabaseClient = ReturnType<typeof createClient>;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function isPermanentStepFailure(step: any): boolean {
  const meta = (step?.meta ?? {}) as Record<string, unknown>;
  const cls = String(meta?.last_error_class ?? "");
  if (cls === "permanent") return true;
  const kind = String(meta?.last_error_kind ?? "");
  if (["check_violation", "not_null_violation", "foreign_key_violation", "rls_denied", "unique_violation"].includes(kind)) return true;
  const lastErr = String(step?.last_error ?? "");
  if (lastErr.toUpperCase().includes("SSOT_GUARD")) return true;
  if (lastErr.toUpperCase().includes("HTTP 422 PERMANENT")) return true;
  return false;
}

export async function safeRpc(
  sb: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[stuck-scan] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[stuck-scan] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}
