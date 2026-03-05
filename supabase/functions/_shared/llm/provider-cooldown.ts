// supabase/functions/_shared/llm/provider-cooldown.ts
// Persistent provider cooldown tracking via DB (llm_provider_cooldowns)
// Falls back to in-memory if DB write fails (best-effort)
// IMPORTANT: This file is Edge-Function-only (Deno). Never import from client.

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
  // Hard guard: prevent accidental client bundling
  if (typeof Deno === "undefined") return null;

  const url = Deno.env.get("SUPABASE_URL");
  const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !sKey) return null;
  return createClient(url, sKey, { auth: { persistSession: false } });
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
 * Only queries DB for the specific provider+model pairs in the chain (no full-table scan).
 * Returns the filtered chain. If ALL are on cooldown, returns the
 * one with the shortest remaining cooldown (never returns empty).
 */
export async function filterCooledDownProviders(
  chain: { provider: string; model: string; [k: string]: unknown }[],
): Promise<typeof chain> {
  if (chain.length <= 1) return chain;

  const sb = getSb();
  if (!sb) return chain;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  try {
    // Targeted OR filter: only check chain members (no full-table scan)
    const ors = chain
      .map(c => `and(provider.eq.${c.provider},model.eq.${c.model})`)
      .join(",");

    const { data: activeCooldowns, error } = await sb
      .from("llm_provider_cooldowns")
      .select("provider, model, until_at, reason")
      .gt("until_at", nowIso)
      .or(ors);

    if (error || !activeCooldowns || activeCooldowns.length === 0) return chain;

    const cooldownMap = new Map(
      activeCooldowns.map((c: any) => [key(c.provider, c.model), c])
    );

    const available = chain.filter(c => !cooldownMap.has(key(c.provider, c.model)));
    if (available.length > 0) {
      if (available.length < chain.length) {
        const skipped = chain.filter(c => cooldownMap.has(key(c.provider, c.model)));
        for (const s of skipped) {
          const cd = cooldownMap.get(key(s.provider, s.model));
          const remainSec = cd ? Math.round((new Date(cd.until_at).getTime() - nowMs) / 1000) : 0;
          console.warn(`[COOLDOWN] SKIP ${s.provider}/${s.model} (${remainSec}s remaining, reason: ${cd?.reason ?? "?"})`);
        }
      }
      return available;
    }

    // All on cooldown — pick the one expiring soonest
    let best = chain[0];
    let bestUntil = Infinity;
    for (const c of chain) {
      const cd = cooldownMap.get(key(c.provider, c.model));
      const until = cd ? new Date(cd.until_at).getTime() : 0;
      if (until < bestUntil) {
        bestUntil = until;
        best = c;
      }
    }
    const remainSec = Math.round((bestUntil - nowMs) / 1000);
    console.warn(`[COOLDOWN] ALL providers on cooldown — using least-cooled: ${best.provider}/${best.model} (${remainSec}s remaining)`);
    return [best];
  } catch (e) {
    console.warn(`[COOLDOWN] DB check failed (proceeding unfiltered): ${(e as Error)?.message?.slice(0, 100)}`);
    return chain;
  }
}

// ── Probabilistic cleanup (max 1x per 10min per isolate) ──
let _lastCleanupAt = 0;

/**
 * Cleanup expired cooldowns. Throttled to max once per 10 minutes.
 */
export async function cleanupExpiredCooldowns(): Promise<number> {
  const now = Date.now();
  if (now - _lastCleanupAt < 10 * 60_000) return 0;
  _lastCleanupAt = now;

  const sb = getSb();
  if (!sb) return 0;

  try {
    const { data, error } = await sb
      .from("llm_provider_cooldowns")
      .delete()
      .lt("until_at", new Date().toISOString())
      .select("provider");
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}
