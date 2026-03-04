/**
 * Provider Rate Limiter — Proactive Token-Bucket + Progressive Cooldown
 *
 * Features:
 *   1. Per-provider request-per-minute tracking (token bucket)
 *   2. Progressive cooldown after N consecutive 429s (30s→60s→120s→300s)
 *   3. Auto-clear expired cooldowns with de-escalation
 *   4. Hard caps on timestamp arrays to prevent memory leaks
 *   5. Provider health status for smart routing decisions
 *
 * All state is in-memory (per Edge Function isolate).
 * This is intentional: each isolate independently throttles,
 * providing distributed backpressure without DB overhead.
 */

export type AIProvider = "openai" | "anthropic" | "google" | "lovable";

// ── Configuration ───────────────────────────────────────────────────

/** Max requests per minute per provider (conservative defaults) */
const RPM_LIMITS: Record<AIProvider, number> = {
  openai: 80,
  anthropic: 40,
  google: 60,
  lovable: 60,
};

/** Number of 429s within COOLDOWN_WINDOW_MS to trigger cooldown */
const COOLDOWN_TRIGGER_COUNT = 6;
/** Window in which COOLDOWN_TRIGGER_COUNT 429s trigger a cooldown */
const COOLDOWN_WINDOW_MS = 60_000;
/** Progressive cooldown durations — each consecutive trigger escalates */
const COOLDOWN_STEPS_MS = [30_000, 60_000, 120_000, 300_000];

/** Hard caps to prevent unbounded memory growth */
const MAX_REQUEST_TIMESTAMPS = 500;
const MAX_RATELIMIT_TIMESTAMPS = 200;

// ── Internal State ──────────────────────────────────────────────────

interface ProviderState {
  /** Timestamps of recent requests (sliding window) */
  requestTimestamps: number[];
  /** Timestamps of recent 429 errors */
  rateLimitTimestamps: number[];
  /** If set, provider is in cooldown until this epoch ms */
  cooldownUntil: number | null;
  /** How many times cooldown was triggered (for progressive backoff) */
  cooldownCount: number;
  /** Total 429s since isolate start */
  total429s: number;
  /** Total requests since isolate start */
  totalRequests: number;
}

const state: Record<AIProvider, ProviderState> = {
  openai: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, cooldownCount: 0, total429s: 0, totalRequests: 0 },
  anthropic: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, cooldownCount: 0, total429s: 0, totalRequests: 0 },
  google: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, cooldownCount: 0, total429s: 0, totalRequests: 0 },
  lovable: { requestTimestamps: [], rateLimitTimestamps: [], cooldownUntil: null, cooldownCount: 0, total429s: 0, totalRequests: 0 },
};

// ── Helpers ──────────────────────────────────────────────────────────

function pruneOlderThan(arr: number[], cutoff: number): number[] {
  while (arr.length > 0 && arr[0] < cutoff) arr.shift();
  return arr;
}

/** Prune + hard-cap an array to prevent memory leaks in long-lived isolates */
function pruneAndCap(arr: number[], cutoff: number, maxLen: number): number[] {
  pruneOlderThan(arr, cutoff);
  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
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
  cooldownStep: number;
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

  // Prune + cap old timestamps
  pruneAndCap(s.requestTimestamps, now - 60_000, MAX_REQUEST_TIMESTAMPS);
  pruneAndCap(s.rateLimitTimestamps, now - COOLDOWN_WINDOW_MS, MAX_RATELIMIT_TIMESTAMPS);

  const rpm = s.requestTimestamps.length;
  const rpmLimit = RPM_LIMITS[provider];

  // Check active cooldown
  if (s.cooldownUntil && now < s.cooldownUntil) {
    return {
      provider,
      available: false,
      reason: `cooldown (${Math.ceil((s.cooldownUntil - now) / 1000)}s remaining, step ${s.cooldownCount})`,
      rpm,
      rpmLimit,
      cooldownRemainingMs: s.cooldownUntil - now,
      cooldownStep: s.cooldownCount,
      total429s: s.total429s,
      totalRequests: s.totalRequests,
    };
  }

  // Auto-clear expired cooldown + de-escalate one step
  if (s.cooldownUntil && now >= s.cooldownUntil) {
    s.cooldownUntil = null;
    s.cooldownCount = Math.max(0, s.cooldownCount - 1);
    console.info(`[RATE-LIMITER] ✅ Provider ${provider} cooldown expired (escalation step now ${s.cooldownCount})`);
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
      cooldownStep: s.cooldownCount,
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
    cooldownStep: s.cooldownCount,
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
  const now = Date.now();
  s.requestTimestamps.push(now);
  s.totalRequests++;
  // Prevent unbounded growth
  if (s.requestTimestamps.length > MAX_REQUEST_TIMESTAMPS) {
    s.requestTimestamps.splice(0, s.requestTimestamps.length - MAX_REQUEST_TIMESTAMPS);
  }
}

/**
 * Record a 429 (rate limit) response from a provider.
 * Only 429s trigger cooldown escalation (not 503/timeouts).
 */
export function recordRateLimit(provider: AIProvider): void {
  const s = state[provider];
  const now = Date.now();

  s.rateLimitTimestamps.push(now);
  s.total429s++;

  // Prune + cap
  pruneAndCap(s.rateLimitTimestamps, now - COOLDOWN_WINDOW_MS, MAX_RATELIMIT_TIMESTAMPS);

  // Check if cooldown should be triggered
  if (s.rateLimitTimestamps.length >= COOLDOWN_TRIGGER_COUNT) {
    const stepIdx = Math.min(s.cooldownCount, COOLDOWN_STEPS_MS.length - 1);
    const duration = COOLDOWN_STEPS_MS[stepIdx];
    s.cooldownUntil = now + duration;
    const nextCount = s.cooldownCount + 1;
    console.warn(
      `[RATE-LIMITER] ⚠️ Provider ${provider} entered cooldown for ${duration / 1000}s ` +
      `(step ${nextCount}/${COOLDOWN_STEPS_MS.length}, ` +
      `${s.rateLimitTimestamps.length} 429s in ${COOLDOWN_WINDOW_MS / 1000}s)`
    );
    s.cooldownCount = nextCount;
  }
}

/**
 * Record a successful response from a provider.
 * De-escalates cooldown step on sustained success (provider recovered).
 */
export function recordSuccess(provider: AIProvider): void {
  const s = state[provider];
  // Only de-escalate when not actively in cooldown (i.e. provider is serving again)
  if (s.cooldownCount > 0 && !s.cooldownUntil) {
    s.cooldownCount = Math.max(0, s.cooldownCount - 1);
  }
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
  const withHealth = candidates
    .map(c => ({ ...c, health: getProviderHealth(c.provider) }))
    .filter(c => {
      if (requiredApiKeys && !requiredApiKeys[c.provider]) return false;
      return c.health.available;
    })
    .sort((a, b) => {
      // Weighted round-robin: prefer providers with more capacity
      const aCapacity = 1 - (a.health.rpm / a.health.rpmLimit);
      const bCapacity = 1 - (b.health.rpm / b.health.rpmLimit);
      return bCapacity - aCapacity;
    });

  return withHealth[0] ?? null;
}

/**
 * Get health summary for all providers (for monitoring/logging).
 */
export function getAllProviderHealth(): ProviderHealth[] {
  return (["openai", "anthropic", "google", "lovable"] as AIProvider[]).map(getProviderHealth);
}

/**
 * Force-clear cooldown for a provider (admin override).
 */
export function clearCooldown(provider: AIProvider): void {
  state[provider].cooldownUntil = null;
  state[provider].cooldownCount = 0;
  state[provider].rateLimitTimestamps = [];
  console.info(`[RATE-LIMITER] ✅ Cooldown force-cleared for ${provider}`);
}
