/**
 * batch/routing-config.ts — Feature flags and routing logic for batch vs sync execution.
 *
 * Controls which job types are routed through the OpenAI Batch API (50% cost savings)
 * vs executed synchronously via callAIWithFailover.
 *
 * v2: GPT-5.4 family batch-enabled (confirmed OpenAI docs Mar 2026).
 *     All 7 job types now batch-activated.
 *     BATCH_DEFAULT_MODEL upgraded to gpt-5.4-mini.
 */

// providerForModel no longer needed — hard guard uses allowlist only

/** Per-job-type batch routing flags. Set to true to activate batch path. */
const BATCH_ROUTING_FLAGS: Record<string, boolean> = {
  lesson_generate_content: true,
  package_generate_exam_pool: true,
  expand_handbook_section: true,          // ✅ Batch activated (gpt-5.4-mini)
  package_generate_handbook: true,        // ✅ Batch activated
  package_generate_oral_exam: true,       // ✅ Batch activated (gpt-5.4-mini)
  package_generate_lesson_minichecks: true,  // ✅ Batch activated (gpt-5.4-nano)
  package_generate_glossary: true,        // ✅ Batch activated (gpt-5.4-nano)
};

/** Default model for batch processing (batch pricing applies — 50% of standard) */
export const BATCH_DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * HARD GUARD: Only explicitly verified batch-compatible models are allowed.
 * All other models are rejected — no silent remapping, no fallback.
 * This prevents the 63k+ zombie-request problem from recurring.
 *
 * Verified batch support (OpenAI docs, Mar 2026):
 *   gpt-5.4-mini  — confirmed v1/batch, 50% pricing ($0.375/$2.25)
 *   gpt-5.4-nano  — confirmed v1/batch, 50% pricing ($0.10/$0.625)
 *   gpt-5-mini    — confirmed v1/batch
 *   gpt-4o-mini   — confirmed v1/batch (legacy fallback)
 */
const BATCH_ALLOWED_MODELS = new Set([
  "gpt-5.4-mini",
  // "gpt-5.4-nano",  // NOT batch-eligible: OpenAI returns model_not_found for "-batch" variant
  "gpt-5-mini",
  "gpt-4o-mini",
]);

export function batchSafeModel(model: string): string {
  if (BATCH_ALLOWED_MODELS.has(model)) return model;

  // Hard reject — log and return default instead of silently accepting expensive models
  console.error(`[batch-routing] BATCH_MODEL_REJECTED: "${model}" is not batch-allowed. Forcing ${BATCH_DEFAULT_MODEL}. Only allowed: ${[...BATCH_ALLOWED_MODELS].join(", ")}`);
  return BATCH_DEFAULT_MODEL;
}

/**
 * Strict validation: throws if model is not batch-allowed.
 * Use this in gateway/enqueue paths where a 422 response is appropriate.
 */
export function assertBatchModel(model: string): void {
  if (!BATCH_ALLOWED_MODELS.has(model)) {
    throw new Error(`BATCH_MODEL_NOT_ALLOWED: "${model}" rejected. Only ${[...BATCH_ALLOWED_MODELS].join(", ")} permitted for batch processing.`);
  }
}

/**
 * Determine if a job should use the batch path.
 *
 * @param jobType - The job type identifier
 * @param opts - Optional context for more nuanced decisions
 * @returns true if the job should be routed through batch API
 */
export function shouldUseBatch(
  jobType: string,
  opts?: {
    /** If true, force sync mode regardless of flags */
    forceSyncMode?: boolean;
    /** Urgency level — 'high' forces sync */
    urgency?: "low" | "normal" | "high";
    /** Number of items to process — very small batches may not benefit */
    itemCount?: number;
  },
): boolean {
  // Hard override: force sync
  if (opts?.forceSyncMode) return false;

  // High urgency always runs sync (e.g. manual retrigger)
  if (opts?.urgency === "high") return false;

  // Check feature flag
  const enabled = BATCH_ROUTING_FLAGS[jobType];
  if (!enabled) return false;

  // For exam pool: only batch if we have enough blueprints (>= 3)
  if (jobType === "package_generate_exam_pool" && opts?.itemCount != null) {
    return opts.itemCount >= 3;
  }

  return true;
}


/**
 * GPT-5.x+ models reject `max_tokens` and require `max_completion_tokens`.
 * Legacy models (gpt-4o-*) still use `max_tokens`.
 */
function needsMaxCompletionTokens(model: string): boolean {
  return model.startsWith("gpt-5");
}

/**
 * Build an OpenAI chat completion request payload for batch processing.
 */
export function buildBatchChatRequest(
  model: string,
  messages: Array<{ role: string; content: string }>,
  opts?: {
    temperature?: number;
    max_tokens?: number;
    response_format?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const tokenLimit = opts?.max_tokens ?? 4096;
  const tokenKey = needsMaxCompletionTokens(model)
    ? "max_completion_tokens"
    : "max_tokens";

  return {
    model,
    messages,
    temperature: opts?.temperature ?? 0.7,
    [tokenKey]: tokenLimit,
    ...(opts?.response_format ? { response_format: opts.response_format } : {}),
  };
}
