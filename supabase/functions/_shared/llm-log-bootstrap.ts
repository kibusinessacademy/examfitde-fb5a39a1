/**
 * llm-log-bootstrap.ts — Auto-logging bootstrap for edge functions
 *
 * Call `bootstrapLLMLogging(sb, jobType)` at the top of any edge function
 * to enable automatic per-attempt cost logging inside callAIWithFailover.
 *
 * This sets globalThis.__llmLogSb and __llmJobType so the auto-logger
 * can fire without explicit sb/jobContext parameters.
 */

export function bootstrapLLMLogging(
  sb: { from: (table: string) => any },
  jobType: string,
) {
  (globalThis as any).__llmLogSb = sb;
  (globalThis as any).__llmJobType = jobType;

  // Also register the supabase client module for auto-log fallback
  try {
    const mod = { createClient: () => sb };
    (globalThis as any).__supabaseClientModule = (globalThis as any).__supabaseClientModule || mod;
  } catch { /* best-effort */ }
}

/**
 * Clear the global logging context (optional, for cleanup).
 */
export function clearLLMLogging() {
  (globalThis as any).__llmLogSb = null;
  (globalThis as any).__llmJobType = null;
}
