// supabase/functions/_shared/llm/provider-cooldown.ts
// Persistent provider cooldown tracking via DB (llm_provider_cooldowns)
// NOW JOB-TYPE SCOPED: cooldowns from one job_type don't poison others.
// IMPORTANT: This file is Edge-Function-only (Deno). Never import from client.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

interface CooldownEntry {
  until: number;
  reason: string;
}

// In-memory fallback (per-invocation only)
const _memCache = new Map<string, CooldownEntry>();

function key(provider: string, model: string, jobType: string = "__global__"): string {
  return `${provider}::${model}::${jobType}`;
}

function getSb() {
  if (typeof Deno === "undefined") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !sKey) return null;
  return createClient(url, sKey, { auth: { persistSession: false } });
}

/**
 * Set a cooldown for a specific provider+model, scoped to a job_type.
 * job_type defaults to '__global__' for backward compat.
 */
export async function setProviderCooldown(opts: {
  provider: string;
  model: string;
  ms: number;
  reason: string;
  jobType?: string;
}): Promise<void> {
  const jobType = opts.jobType ?? "__global__";
  const untilAt = new Date(Date.now() + opts.ms).toISOString();
  const k = key(opts.provider, opts.model, jobType);

  _memCache.set(k, { until: Date.now() + opts.ms, reason: opts.reason });

  const sb = getSb();
  if (sb) {
    try {
      await sb.from("llm_provider_cooldowns").upsert({
        provider: opts.provider,
        model: opts.model,
        job_type: jobType,
        until_at: untilAt,
        reason: opts.reason,
        set_at: new Date().toISOString(),
      }, { onConflict: "provider,model,job_type" });
    } catch (e) {
      console.warn(`[COOLDOWN] DB persist failed (best-effort): ${(e as Error)?.message?.slice(0, 100)}`);
    }
  }

  console.warn(`[COOLDOWN] SET ${opts.provider}/${opts.model} [${jobType}] for ${Math.round(opts.ms / 1000)}s — reason: ${opts.reason}`);
}

/**
 * Check if a provider+model is on cooldown for a specific job_type.
 * Checks BOTH the job-scoped entry AND __global__ (either blocks).
 */
export async function isOnCooldown(provider: string, model: string, jobType?: string): Promise<boolean> {
  const scopes = jobType && jobType !== "__global__"
    ? [jobType, "__global__"]
    : ["__global__"];

  for (const scope of scopes) {
    const k = key(provider, model, scope);
    const mem = _memCache.get(k);
    if (mem && Date.now() < mem.until) return true;
    if (mem) _memCache.delete(k);
  }

  const sb = getSb();
  if (!sb) return false;

  try {
    const orFilter = scopes.map(s => `job_type.eq.${s}`).join(",");
    const { data } = await sb
      .from("llm_provider_cooldowns")
      .select("until_at")
      .eq("provider", provider)
      .eq("model", model)
      .or(orFilter)
      .gt("until_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Filter a model chain to skip cooled-down providers.
 * Job-type-aware: checks both scoped AND global cooldowns.
 */
export async function filterCooledDownProviders(
  chain: { provider: string; model: string; [k: string]: unknown }[],
  jobType?: string,
): Promise<typeof chain> {
  if (chain.length <= 1) return chain;

  const sb = getSb();
  if (!sb) return chain;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const scopes = jobType && jobType !== "__global__"
    ? [jobType, "__global__"]
    : ["__global__"];

  try {
    const ors = chain
      .map(c => `and(provider.eq.${c.provider},model.eq.${c.model})`)
      .join(",");

    const { data: activeCooldowns, error } = await sb
      .from("llm_provider_cooldowns")
      .select("provider, model, job_type, until_at, reason")
      .gt("until_at", nowIso)
      .in("job_type", scopes)
      .or(ors);

    if (error || !activeCooldowns || activeCooldowns.length === 0) return chain;

    const cooldownSet = new Set(
      activeCooldowns.map((c: any) => `${c.provider}::${c.model}`)
    );

    const available = chain.filter(c => !cooldownSet.has(`${c.provider}::${c.model}`));
    if (available.length > 0) {
      if (available.length < chain.length) {
        const skipped = chain.filter(c => cooldownSet.has(`${c.provider}::${c.model}`));
        for (const s of skipped) {
          const cd = activeCooldowns.find((c: any) => c.provider === s.provider && c.model === s.model);
          const remainSec = cd ? Math.round((new Date(cd.until_at).getTime() - nowMs) / 1000) : 0;
          console.warn(`[COOLDOWN] SKIP ${s.provider}/${s.model} [${cd?.job_type ?? "?"}] (${remainSec}s remaining, reason: ${cd?.reason ?? "?"})`);
        }
      }
      return available;
    }

    // All on cooldown — pick the one expiring soonest
    let best = chain[0];
    let bestUntil = Infinity;
    for (const c of chain) {
      const cd = activeCooldowns.find((x: any) => x.provider === c.provider && x.model === c.model);
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
