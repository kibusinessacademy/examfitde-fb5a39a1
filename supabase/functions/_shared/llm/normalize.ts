// supabase/functions/_shared/llm/normalize.ts
// SSOT: Transient LLM error detection + empty-response guard + provider cooldown classification

export type LlmText = { text: string; raw?: unknown };

/**
 * Guard: throw if LLM returned empty/whitespace-only text.
 * The thrown error is classified as "transient" by isTransientLlmError().
 */
export function assertNonEmptyText(out: LlmText, context: string): string {
  const t = (out?.text ?? "").trim();
  if (!t) {
    const err = new Error(`LLM_EMPTY_RESPONSE: ${context}`);
    (err as any).name = "LLM_EMPTY_RESPONSE";
    throw err;
  }
  return t;
}

/**
 * Classify whether an error is transient (retry-safe) or permanent.
 * Transient errors must NOT increment stall_runs or attempts —
 * they represent infrastructure issues, not content-generation failures.
 */
export function isTransientLlmError(err: unknown): boolean {
  const raw = (err as any)?.message ?? (err as any)?.error ?? String(err ?? "");
  const msg = String(raw).toLowerCase();

  // Hard rule: provider-layer failures are always transient
  if (msg.includes("all providers failed")) return true;

  const TRANSIENT_PATTERNS = [
    // Network / connectivity
    "timed out", "timeout", "request timeout",
    "aborterror", "signal is aborted", "fetch failed",
    "network error", "econnreset", "econnrefused", "enotfound",
    "eai_again", "socket hang up", "tls",
    "connection closed", "connection reset", "connection",
    "broken pipe", "server closed the connection",
    // Provider overload / availability
    "rate limit", "rate_limit", "429", "503", "502", "504",
    "service unavailable", "overloaded", "temporarily unavailable",
    "upstream", "bad gateway", "gateway",
    // App-level known transient signatures
    "llm_empty_response", "empty response", "llm_timeout",
    "empty/timeout result", "transient",
    // v13: Empty response patterns (gpt-5-nano killer)
    "no content returned", "empty_response", "no parseable tool response",
    // v14: Operational guards — NOT content failures, must not consume attempts
    "stale lock", "state lock", "stale_lock",
    "health_gate", "health gate",
    "ops_guard", "non_building_package",
    "edge function exceeded",
    "deferred", "all candidates on cooldown",
    // v15: Pipeline prerequisite not met — transient, retry with backoff
    "prereq_not_done", "prereq not done",
    "http 409",
  ];

  return TRANSIENT_PATTERNS.some(p => msg.includes(p));
}

// ── v13: Rich error classification with provider cooldown ──────

export interface ErrorClassification {
  isTransient: boolean;
  reason: string;
  providerCooldownMs?: number;
}

/**
 * Classify an error with cooldown recommendation.
 * Use this in the runner to decide whether to rotate providers.
 */
export function classifyError(err: unknown): ErrorClassification {
  const raw = (err as any)?.message ?? (err as any)?.error ?? String(err ?? "");
  const rawStr = String(raw ?? "");
  const msg = rawStr.toLowerCase();

  // Empty response / blank output = transient + SHORT cooldown (2 min)
  if (
    rawStr.trim().length === 0 ||
    msg.includes("empty response") ||
    msg.includes("empty_response") ||
    msg.includes("llm_empty_response") ||
    msg.includes("no content returned") ||
    msg.includes("no parseable tool response")
  ) {
    return {
      isTransient: true,
      reason: "ops_empty_response",
      providerCooldownMs: 30_000, // 30s (was 2 min — too aggressive when all providers affected)
    };
  }

  // 429 rate limit = transient + moderate cooldown
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limit")) {
    return {
      isTransient: true,
      reason: "ops_rate_limited",
      providerCooldownMs: 45_000, // 45s (was 3 min — prevents all-provider lockout)
    };
  }

  // 503 / timeouts = transient + short cooldown
  if (
    msg.includes("503") || msg.includes("502") || msg.includes("504") ||
    msg.includes("timeout") || msg.includes("timed out") ||
    msg.includes("llm_timeout") || msg.includes("service unavailable") ||
    msg.includes("bad gateway") || msg.includes("overloaded")
  ) {
    return {
      isTransient: true,
      reason: "ops_transient_timeout",
      providerCooldownMs: 30_000, // 30s (was 3 min — 503s recover fast)
    };
  }

  // Network errors = transient, no specific cooldown
  if (
    msg.includes("fetch failed") || msg.includes("econnreset") ||
    msg.includes("econnrefused") || msg.includes("network error") ||
    msg.includes("signal is aborted") || msg.includes("aborterror")
  ) {
    return { isTransient: true, reason: "ops_network_error" };
  }

  // Provider-layer aggregate failures
  if (msg.includes("all providers failed")) {
    return {
      isTransient: true,
      reason: "ops_all_providers_failed",
      providerCooldownMs: 20_000, // 20s (was 2 min — shortest, since all already failed)
    };
  }

  // Operational guards (stale locks, health gate, OPS_GUARD) = transient, no cooldown needed
  if (
    msg.includes("stale lock") || msg.includes("state lock") || msg.includes("stale_lock") ||
    msg.includes("health_gate") || msg.includes("health gate") ||
    msg.includes("ops_guard") || msg.includes("non_building_package") ||
    msg.includes("edge function exceeded") ||
    msg.includes("deferred") || msg.includes("all candidates on cooldown")
  ) {
    return { isTransient: true, reason: "ops_guard_or_lock" };
  }

  // Check generic transient (catch-all for patterns in isTransientLlmError)
  if (isTransientLlmError(err)) {
    return { isTransient: true, reason: "ops_transient_generic" };
  }

  return { isTransient: false, reason: "permanent_or_unknown" };
}

/**
 * Log warning for LLM errors that were NOT classified as transient.
 * Helps detect missing patterns before they cause false-permanent failures.
 */
export function warnIfUnclassifiedLlmError(
  err: unknown,
  context: { provider?: string; model?: string },
): void {
  if (isTransientLlmError(err)) return;
  const msg = String((err as any)?.message ?? err ?? "").slice(0, 180);
  console.warn("[llm] UNCLASSIFIED_NON_TRANSIENT", {
    sample: msg,
    provider: context.provider ?? "unknown",
    model: context.model ?? "unknown",
  });
}
