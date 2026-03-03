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
  const msg = String(e?.message ?? "");
  const name = String(e?.name ?? "");
  return (
    name.includes("LLM_EMPTY_RESPONSE") ||
    msg.includes("LLM_EMPTY_RESPONSE") ||
    msg.includes("Empty response") ||
    msg.includes("empty response") ||
    msg.includes("LLM_TIMEOUT") ||
    msg.includes("timeout") ||
    msg.includes("TIMEOUT") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("Rate limit") ||
    msg.includes("rate limit") ||
    msg.includes("aborted")
  );
}
