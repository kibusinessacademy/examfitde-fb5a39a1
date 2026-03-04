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
export function isTransientLlmError(e: any): boolean {
  const msg = String(e?.message ?? "").toLowerCase();
  const name = String(e?.name ?? "").toLowerCase();
  const combined = `${name} ${msg}`;
  return (
    combined.includes("llm_empty_response") ||
    combined.includes("empty response") ||
    combined.includes("llm_timeout") ||
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("timed_out") ||
    combined.includes("etimedout") ||
    combined.includes("econnreset") ||
    combined.includes("econnrefused") ||
    combined.includes("fetch failed") ||
    combined.includes("connection") ||
    combined.includes("429") ||
    combined.includes("503") ||
    combined.includes("rate limit") ||
    combined.includes("rate_limit") ||
    combined.includes("aborted") ||
    combined.includes("all providers failed") ||
    combined.includes("signal") ||
    combined.includes("network")
  );
}
