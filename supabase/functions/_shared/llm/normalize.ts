// supabase/functions/_shared/llm/normalize.ts
// SSOT: Transient LLM error detection + empty-response guard

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
  ];

  return TRANSIENT_PATTERNS.some(p => msg.includes(p));
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
