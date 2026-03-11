// supabase/functions/_shared/llm/provider-circuit-breaker.ts
// Cross-invocation circuit breaker for AI provider permanent failures.
// When ALL providers are permanently down (e.g. credits exhausted),
// pauses the pipeline to prevent DB-hammering retry storms.
// IMPORTANT: Edge-Function-only (Deno). Never import from client.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/** How many consecutive "all providers permanently failed" results trigger the breaker */
const PERMANENT_FAIL_THRESHOLD = 3;

/** How long the pipeline stays paused (10 minutes) */
const PAUSE_DURATION_MS = 10 * 60_000;

/** Pipeline settings key for circuit breaker state */
const CB_KEY = "provider_circuit_breaker";

interface CircuitBreakerState {
  tripped: boolean;
  tripped_at: string;
  expires_at: string;
  reason: string;
  consecutive_permanent_fails: number;
}

function getSb() {
  if (typeof Deno === "undefined") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !sKey) return null;
  return createClient(url, sKey, { auth: { persistSession: false } });
}

// In-memory state for within-invocation tracking
let _consecutivePermanentFails = 0;

/**
 * Check if the circuit breaker is currently tripped.
 * Returns { paused: true, reason, expiresAt } if pipeline should stop.
 * Returns { paused: false } if pipeline can proceed.
 */
export async function checkCircuitBreaker(): Promise<{
  paused: boolean;
  reason?: string;
  expiresAt?: string;
  remainingMs?: number;
}> {
  const sb = getSb();
  if (!sb) return { paused: false };

  try {
    const { data } = await sb
      .from("pipeline_settings")
      .select("value")
      .eq("key", CB_KEY)
      .maybeSingle();

    if (!data?.value) return { paused: false };

    const state: CircuitBreakerState = typeof data.value === "string"
      ? JSON.parse(data.value)
      : data.value;

    if (!state.tripped) return { paused: false };

    const expiresAt = new Date(state.expires_at).getTime();
    const now = Date.now();

    if (now >= expiresAt) {
      // Expired — auto-reset
      await resetCircuitBreaker("auto_expired");
      return { paused: false };
    }

    return {
      paused: true,
      reason: state.reason,
      expiresAt: state.expires_at,
      remainingMs: expiresAt - now,
    };
  } catch (e) {
    console.warn(`[CIRCUIT-BREAKER] check failed (proceeding): ${(e as Error)?.message?.slice(0, 100)}`);
    return { paused: false };
  }
}

/**
 * Record a permanent provider failure (e.g. credits exhausted, auth error).
 * After PERMANENT_FAIL_THRESHOLD consecutive failures, trips the breaker.
 */
export async function recordPermanentProviderFailure(reason: string): Promise<boolean> {
  _consecutivePermanentFails++;

  if (_consecutivePermanentFails < PERMANENT_FAIL_THRESHOLD) {
    console.warn(
      `[CIRCUIT-BREAKER] permanent fail ${_consecutivePermanentFails}/${PERMANENT_FAIL_THRESHOLD}: ${reason}`,
    );
    return false;
  }

  // Trip the breaker
  const sb = getSb();
  if (!sb) return false;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAUSE_DURATION_MS);

  const state: CircuitBreakerState = {
    tripped: true,
    tripped_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    reason,
    consecutive_permanent_fails: _consecutivePermanentFails,
  };

  try {
    await sb.from("pipeline_settings").upsert(
      { key: CB_KEY, value: JSON.stringify(state) },
      { onConflict: "key" },
    );

    // Log health event
    try {
      await sb.from("pipeline_health_events").insert({
        severity: "P0",
        kind: "circuit_breaker_tripped",
        meta: {
          reason,
          consecutive_fails: _consecutivePermanentFails,
          pause_until: expiresAt.toISOString(),
        },
      });
    } catch { /* best-effort */ }

    console.error(
      `[CIRCUIT-BREAKER] 🔴 TRIPPED — all providers permanently failing. ` +
      `Pipeline paused for ${PAUSE_DURATION_MS / 60_000} min. Reason: ${reason}`,
    );

    return true;
  } catch (e) {
    console.error(`[CIRCUIT-BREAKER] trip failed: ${(e as Error)?.message?.slice(0, 100)}`);
    return false;
  }
}

/**
 * Record a successful provider call — resets the permanent failure counter.
 */
export function recordProviderSuccess(): void {
  if (_consecutivePermanentFails > 0) {
    console.log(`[CIRCUIT-BREAKER] ✅ provider success — resetting fail counter from ${_consecutivePermanentFails}`);
  }
  _consecutivePermanentFails = 0;
}

/**
 * Reset the circuit breaker (admin override or auto-expiry).
 */
export async function resetCircuitBreaker(reason = "manual_reset"): Promise<void> {
  _consecutivePermanentFails = 0;

  const sb = getSb();
  if (!sb) return;

  try {
    await sb.from("pipeline_settings").upsert(
      {
        key: CB_KEY,
        value: JSON.stringify({
          tripped: false,
          reset_at: new Date().toISOString(),
          reset_reason: reason,
        }),
      },
      { onConflict: "key" },
    );
    console.log(`[CIRCUIT-BREAKER] ✅ Reset — reason: ${reason}`);
  } catch { /* best-effort */ }
}

/**
 * Detect if an error message indicates a PERMANENT provider failure
 * (not transient like rate limits or timeouts).
 */
export function isPermanentProviderError(errorStr: string): boolean {
  const lower = errorStr.toLowerCase();
  return (
    lower.includes("credit balance is too low") ||
    lower.includes("insufficient_quota") ||
    lower.includes("billing") ||
    lower.includes("payment required") ||
    lower.includes("402") ||
    lower.includes("authentication") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("unauthorized") ||
    lower.includes("403") ||
    (lower.includes("all providers failed") && (
      lower.includes("credit") ||
      lower.includes("billing") ||
      lower.includes("payment") ||
      lower.includes("api key")
    ))
  );
}
