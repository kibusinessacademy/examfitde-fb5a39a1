// supabase/functions/_shared/llm/provider-load-balancer.ts
// Cooldown-aware provider routing via DB policies.
// IMPORTANT: Edge-Function-only (Deno). Never import from client.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export interface RouteResult {
  ok: boolean;
  provider?: string;
  model?: string;
  reason: string;
}

function getSb() {
  if (typeof Deno === "undefined") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !sKey) return null;
  return createClient(url, sKey, { auth: { persistSession: false } });
}

/**
 * Resolve the first healthy provider for a given workload key.
 * Uses the `resolve_available_llm_route` RPC which checks
 * `llm_provider_routing_policies` against `llm_provider_cooldowns`.
 */
export async function resolveAvailableRoute(
  workloadKey: string,
): Promise<RouteResult> {
  const sb = getSb();
  if (!sb) {
    return { ok: false, reason: "no_supabase_client" };
  }

  try {
    const { data, error } = await sb.rpc("resolve_available_llm_route", {
      p_workload_key: workloadKey,
    });

    if (error) {
      console.error(`[LOAD-BALANCER] RPC error for ${workloadKey}:`, error.message);
      return { ok: false, reason: `rpc_error: ${error.message}` };
    }

    const result = data as RouteResult;
    if (result.ok) {
      console.log(`[LOAD-BALANCER] Routed ${workloadKey} → ${result.provider}/${result.model}`);
    } else {
      console.warn(`[LOAD-BALANCER] No healthy route for ${workloadKey}: ${result.reason}`);
    }

    return result;
  } catch (e) {
    console.error(`[LOAD-BALANCER] Unexpected error:`, (e as Error).message);
    return { ok: false, reason: `exception: ${(e as Error).message}` };
  }
}
