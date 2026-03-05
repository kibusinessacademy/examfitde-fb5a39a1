// supabase/functions/_shared/llm/provider-cooldown.ts
// Persistent provider cooldown tracking via DB (llm_provider_cooldowns)
// Falls back to in-memory if DB write fails (best-effort)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

interface CooldownEntry {
  until: number;
  reason: string;
}

// In-memory fallback (per-invocation only)
const _memCache = new Map<string, CooldownEntry>();

function key(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function getSb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Set a cooldown for a specific provider+model (persisted to DB).
 */
export async function setProviderCooldown(opts: {
  provider: string;
  model: string;
  ms: number;
  reason: string;
}): Promise<void> {
  const untilAt = new Date(Date.now() + opts.ms).toISOString();
  const k = key(opts.provider, opts.model);

  // In-memory (immediate effect within this invocation)
  _memCache.set(k, { until: Date.now() + opts.ms, reason: opts.reason });

  // Persist to DB (cross-invocation)
  const sb = getSb();
  if (sb) {
    try {
      await sb.from("llm_provider_cooldowns").upsert({
        provider: opts.provider,
        model: opts.model,
        until_at: untilAt,
        reason: opts.reason,
        set_at: new Date().toISOString(),
      }, { onConflict: "provider,model" });
    } catch (e) {
      console.warn(`[COOLDOWN] DB persist failed (best-effort): ${(e as Error)?.message?.slice(0, 100)}`);
    }
  }

  console.warn(`[COOLDOWN] SET ${opts.provider}/${opts.model} for ${Math.round(opts.ms / 1000)}s — reason: ${opts.reason}`);
}

/**
 * Check if a provider+model is currently on cooldown (DB + memory).
 */
export async function isOnCooldown(provider: string, model: string): Promise<boolean> {
  const k = key(provider, model);

  // Check in-memory first (fast path)
  const mem = _memCache.get(k);
  if (mem && Date.now() < mem.until) return true;
  if (mem) _memCache.delete(k);

  // Check DB
  const sb = getSb();
  if (!sb) return false;

  try {
    const { data } = await sb
      .from("llm_provider_cooldowns")
      .select("until_at")
      .eq("provider", provider)
      .eq("model", model)
      .gt("until_at", new Date().toISOString())
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Filter a model chain to skip cooled-down providers.
 * Returns the filtered chain. If ALL are on cooldown, returns the
 * one with the shortest remaining cooldown (never returns empty).
 */
export async function filterCooledDownProviders(
  chain: { provider: string; model: string; [k: string]: unknown }[],
): Promise<typeof chain> {
  if (chain.length <= 1) return chain;

  const sb = getSb();
  if (!sb) return chain;

  try {
    const { data: activeCooldowns } = await sb
      .from("llm_provider_cooldowns")
      .select("provider, model, until_at")
      .gt("until_at", new Date().toISOString());

    if (!activeCooldowns || activeCooldowns.length === 0) return chain;

    const cooldownSet = new Set(
      activeCooldowns.map((c: any) => key(c.provider, c.model))
    );

    const available = chain.filter(c => !cooldownSet.has(key(c.provider, c.model)));
    if (available.length > 0) {
      if (available.length < chain.length) {
        const skipped = chain.filter(c => cooldownSet.has(key(c.provider, c.model)));
        console.warn(`[COOLDOWN] Filtered ${skipped.length} cooled-down provider(s): ${skipped.map(s => `${s.provider}/${s.model}`).join(", ")}`);
      }
      return available;
    }

    // All on cooldown — pick the one expiring soonest
    let best = chain[0];
    let bestUntil = Infinity;
    for (const c of chain) {
      const cd = activeCooldowns.find((ac: any) => ac.provider === c.provider && ac.model === c.model);
      const until = cd ? new Date(cd.until_at).getTime() : 0;
      if (until < bestUntil) {
        bestUntil = until;
        best = c;
      }
    }
    console.warn(`[COOLDOWN] ALL providers on cooldown — using least-cooled: ${best.provider}/${best.model}`);
    return [best];
  } catch (e) {
    console.warn(`[COOLDOWN] DB check failed (proceeding unfiltered): ${(e as Error)?.message?.slice(0, 100)}`);
    return chain;
  }
}

/**
 * Cleanup expired cooldowns (call periodically).
 */
export async function cleanupExpiredCooldowns(): Promise<number> {
  const sb = getSb();
  if (!sb) return 0;
  try {
    const { data } = await sb
      .from("llm_provider_cooldowns")
      .delete()
      .lt("until_at", new Date().toISOString())
      .select("provider");
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}
