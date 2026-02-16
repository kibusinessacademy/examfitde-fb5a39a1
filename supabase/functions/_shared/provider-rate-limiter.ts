/**
 * Provider Rate Limiter — Proactive Token-Bucket + Cooldown
 *
 * Features:
 *   1. Per-provider request-per-minute tracking (token bucket)
 *   2. Auto-cooldown after N consecutive 429s within a window
 *   3. Provider health status for smart routing decisions
 *
 * All state is in-memory (per Edge Function isolate).
 * This is intentional: each isolate independently throttles,
 * providing distributed backpressure without DB overhead.
 */

export type AIProvider = "openai" | "anthropic" | "deepseek" | "google";

// ── Configuration ───────────────────────────────────────────────────

/** Max requests per minute per provider (conservative defaults) */
const RPM_LIMITS: Record<AIProvider, number> = {
  openai: 80,
  anthropic: 40,
  deepseek: 30,
  google: 60,
};

/** Number of 429s within COOLDOWN_WINDOW_MS to trigger cooldown */
const COOLDOWN_TRIGGER_COUNT = 3;
/** Window in which COOLDOWN_TRIGGER_COUNT 429s trigger a cooldown */
const COOLDOWN_WINDOW_MS = 60_000;
/** How long to cool down a provider after trigger (ms) */
const COOLDOWN_DURATION_MS = 60_000;

// ── Internal State ──────────────────────────────────────────────────

interface ProviderState {
  /** Timestamps of recent requests (sliding window) */
  requestTimestamps: number[];
  /** Timestamps of recent 429 errors */
  rateLimitTimestamps: number[];
  /** If set, provider is in cooldown until this epoch ms */
  cooldownUntil: number | null;
  /** Total 429s since isolate start */
  total429s: number;
  /** Total requests since isolate start */
  totalRequests: number;
}

const state: Record<AIProvider, ProviderState> = {
  openai: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, total429s: 0, totalRequests: 0 },
  anthropic: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, total429s: 0, totalRequests: 0 },
  deepseek: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, total429s: 0, totalRequests: 0 },
  google: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, total429s: 0, totalRequests: 0 },
};

// ── Helpers ──────────────────────────────────────────────────────────

function pruneOlderThan(arr: number[], cutoff: number): number[] {
  // Mutate in place for efficiency
  while (arr.length > 0 && arr[0] < cutoff) arr.shift();
  return arr;
}

// ── Public API ──────────────────────────────────────────────────────

export interface ProviderHealth {
  provider: AIProvider;
  available: boolean;
  reason?: string;
  rpm: number;
  rpmLimit: number;
  cooldownRemainingMs: number;
  total429s: number;
  totalRequests: number;
}

/**
 * Check if a provider is available for a new request.
 * Returns health info including availability and reason if blocked.
 */
export function getProviderHealth(provider: AIProvider): ProviderHealth {
  const s = state[provider];
  const now = Date.now();

  // Prune old timestamps
  pruneOlderThan(s.requestTimestamps, now - 60_000);
  pruneOlderThan(s.rateLimitTimestamps, now - COOLDOWN_WINDOW_MS);

  const rpm = s.requestTimestamps.length;
  const rpmLimit = RPM_LIMITS[provider];

  // Check cooldown
  if (s.cooldownUntil && now < s.cooldownUntil) {
    return {
      provider,
      available: false,
      reason: `cooldown (${Math.ceil((s.cooldownUntil - now) / 1000)}s remaining)`,
      rpm,
      rpmLimit,
      cooldownRemainingMs: s.cooldownUntil - now,
      total429s: s.total429s,
      totalRequests: s.totalRequests,
    };
  }

  // Clear expired cooldown
  if (s.cooldownUntil && now >= s.cooldownUntil) {
    s.cooldownUntil = null;
  }

  // Check RPM limit (leave 10% headroom)
  if (rpm >= Math.floor(rpmLimit * 0.9)) {
    return {
      provider,
      available: false,
      reason: `rpm_limit (${rpm}/${rpmLimit})`,
      rpm,
      rpmLimit,
      cooldownRemainingMs: 0,
      total429s: s.total429s,
      totalRequests: s.totalRequests,
    };
  }

  return {
    provider,
    available: true,
    rpm,
    rpmLimit,
    cooldownRemainingMs: 0,
    total429s: s.total429s,
    totalRequests: s.totalRequests,
  };
}

/**
 * Record that a request was made to a provider.
 * Call this BEFORE making the actual API call.
 */
export function recordRequest(provider: AIProvider): void {
  const s = state[provider];
  s.requestTimestamps.push(Date.now());
  s.totalRequests++;
}

/**
 * Record a 429 (rate limit) response from a provider.
 * Triggers cooldown if threshold is exceeded.
 */
export function recordRateLimit(provider: AIProvider): void {
  const s = state[provider];
  const now = Date.now();

  s.rateLimitTimestamps.push(now);
  s.total429s++;

  // Prune old 429 timestamps
  pruneOlderThan(s.rateLimitTimestamps, now - COOLDOWN_WINDOW_MS);

  // Check if cooldown should be triggered
  if (s.rateLimitTimestamps.length >= COOLDOWN_TRIGGER_COUNT) {
    s.cooldownUntil = now + COOLDOWN_DURATION_MS;
    console.warn(
      `[RATE-LIMITER] ⚠️ Provider ${provider} entered cooldown for ${COOLDOWN_DURATION_MS / 1000}s ` +
      `(${s.rateLimitTimestamps.length} 429s in ${COOLDOWN_WINDOW_MS / 1000}s)`
    );
  }
}

/**
 * Record a successful response from a provider.
 * Can be used to clear rate limit pressure.
 */
export function recordSuccess(provider: AIProvider): void {
  // Success is implicit — no special action needed.
  // The rate limit timestamps will naturally age out.
}

/**
 * Get the best available provider from a list of candidates.
 * Returns the first available provider, preferring those with lower RPM usage.
 * Returns null if all providers are blocked.
 */
export function pickAvailableProvider(
  candidates: Array<{ provider: AIProvider; model: string }>,
  requiredApiKeys?: Record<string, boolean>,
): { provider: AIProvider; model: string; health: ProviderHealth } | null {
  // Sort by RPM usage (lowest first) for load distribution
  const withHealth = candidates
    .map(c => ({ ...c, health: getProviderHealth(c.provider) }))
    .filter(c => {
      // Skip providers without API keys
      if (requiredApiKeys && !requiredApiKeys[c.provider]) return false;
      return c.health.available;
    })
    .sort((a, b) => {
      // Weighted round-robin: prefer providers with more capacity
      const aCapacity = 1 - (a.health.rpm / a.health.rpmLimit);
      const bCapacity = 1 - (b.health.rpm / b.health.rpmLimit);
      return bCapacity - aCapacity; // higher capacity first
    });

  return withHealth[0] ?? null;
}

/**
 * Get health summary for all providers (for monitoring/logging).
 */
export function getAllProviderHealth(): ProviderHealth[] {
  return (["openai", "anthropic", "deepseek", "google"] as AIProvider[]).map(getProviderHealth);
}

/**
 * Force-clear cooldown for a provider (admin override).
 */
export function clearCooldown(provider: AIProvider): void {
  state[provider].cooldownUntil = null;
  state[provider].rateLimitTimestamps = [];
  console.log(`[RATE-LIMITER] Cooldown cleared for ${provider}`);
}
