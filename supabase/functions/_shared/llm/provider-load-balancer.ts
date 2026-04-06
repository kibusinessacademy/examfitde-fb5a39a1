// supabase/functions/_shared/llm/provider-load-balancer.ts
// Cooldown-aware provider routing via DB policies.
// IMPORTANT: Edge-Function-only (Deno). Never import from client.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export interface RouteResult {
  ok: boolean;
  provider?: string;
  model?: string;
  reason: string;
  lastResort?: boolean; // true when cooldown was bypassed
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

/**
 * LAST-RESORT: When ALL providers for a workload are on cooldown,
 * pick the one whose cooldown expires soonest and force-route through it.
 * This prevents total pipeline stalls from simultaneous cooldowns.
 *
 * Returns null if no policy exists at all (genuine misconfiguration).
 */
export async function resolveLastResortRoute(
  workloadKey: string,
): Promise<RouteResult | null> {
  const sb = getSb();
  if (!sb) return null;

  try {
    // Get the routing policy chain for this workload
    const { data: policy } = await sb
      .from("llm_provider_routing_policies")
      .select("provider_chain")
      .eq("workload_key", workloadKey)
      .eq("is_enabled", true)
      .limit(1)
      .single();

    if (!policy?.provider_chain) return null;

    const chain = policy.provider_chain as Array<{ provider: string; model: string }>;
    if (chain.length === 0) return null;

    // Find the candidate with the shortest remaining cooldown
    let bestCandidate = chain[0];
    let shortestRemaining = Infinity;

    for (const entry of chain) {
      const { data: cd } = await sb
        .from("llm_provider_cooldowns")
        .select("until_at")
        .eq("provider", entry.provider)
        .eq("model", entry.model)
        .gt("until_at", new Date().toISOString())
        .order("until_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!cd) {
        // Not even on cooldown — should have been caught by normal routing
        return { ok: true, provider: entry.provider, model: entry.model, reason: "not_on_cooldown" };
      }

      const remaining = new Date(cd.until_at).getTime() - Date.now();
      if (remaining < shortestRemaining) {
        shortestRemaining = remaining;
        bestCandidate = entry;
      }
    }

    console.warn(
      `[LOAD-BALANCER] LAST_RESORT: ${workloadKey} → ${bestCandidate.provider}/${bestCandidate.model} ` +
      `(cooldown bypassed, shortest remaining: ${Math.round(shortestRemaining / 1000)}s)`
    );

    return {
      ok: true,
      provider: bestCandidate.provider,
      model: bestCandidate.model,
      reason: "last_resort_cooldown_bypass",
      lastResort: true,
    };
  } catch (e) {
    console.error(`[LOAD-BALANCER] LAST_RESORT error:`, (e as Error).message);
    return null;
  }
}
