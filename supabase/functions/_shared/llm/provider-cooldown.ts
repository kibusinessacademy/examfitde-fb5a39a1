// supabase/functions/_shared/llm/provider-cooldown.ts
// In-memory provider cooldown tracking for transient error rotation
// Scoped per edge-function instance (no cross-instance state needed —
// each runner picks its own provider via attempt_index rotation)

interface CooldownEntry {
  until: number;  // epoch ms
  reason: string;
  setAt: number;
}

// Key = "provider::model" e.g. "lovable::openai/gpt-5-mini"
const _cooldowns = new Map<string, CooldownEntry>();

function key(provider: string, model: string): string {
  return `${provider}::${model}`;
}

/**
 * Set a cooldown for a specific provider+model.
 * During cooldown, `isOnCooldown` returns true and the runner should skip.
 */
export function setProviderCooldown(opts: {
  provider: string;
  model: string;
  ms: number;
  reason: string;
}): void {
  const k = key(opts.provider, opts.model);
  const entry: CooldownEntry = {
    until: Date.now() + opts.ms,
    reason: opts.reason,
    setAt: Date.now(),
  };
  _cooldowns.set(k, entry);
  console.warn(`[COOLDOWN] SET ${k} for ${Math.round(opts.ms / 1000)}s — reason: ${opts.reason}`);
}

/**
 * Check if a provider+model is currently on cooldown.
 */
export function isOnCooldown(provider: string, model: string): boolean {
  const k = key(provider, model);
  const entry = _cooldowns.get(k);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    _cooldowns.delete(k);
    return false;
  }
  return true;
}

/**
 * Get remaining cooldown info (for logging/telemetry).
 */
export function getCooldownInfo(provider: string, model: string): { onCooldown: boolean; remainingMs: number; reason: string } | null {
  const k = key(provider, model);
  const entry = _cooldowns.get(k);
  if (!entry) return null;
  const remaining = entry.until - Date.now();
  if (remaining <= 0) {
    _cooldowns.delete(k);
    return null;
  }
  return { onCooldown: true, remainingMs: remaining, reason: entry.reason };
}

/**
 * Filter a model chain to skip cooled-down providers.
 * Returns the filtered chain. If ALL are on cooldown, returns the
 * one with the shortest remaining cooldown (never returns empty).
 */
export function filterCooledDownProviders(
  chain: { provider: string; model: string; [k: string]: unknown }[],
): typeof chain {
  const available = chain.filter(c => !isOnCooldown(c.provider, c.model));
  if (available.length > 0) return available;

  // All on cooldown — pick the one expiring soonest
  let best = chain[0];
  let bestRemaining = Infinity;
  for (const c of chain) {
    const info = getCooldownInfo(c.provider, c.model);
    const rem = info?.remainingMs ?? 0;
    if (rem < bestRemaining) {
      bestRemaining = rem;
      best = c;
    }
  }
  console.warn(`[COOLDOWN] ALL providers on cooldown — using least-cooled: ${best.provider}/${best.model} (${Math.round(bestRemaining / 1000)}s remaining)`);
  return [best];
}

/**
 * Clear all cooldowns (for testing or manual reset).
 */
export function clearAllCooldowns(): void {
  _cooldowns.clear();
}
