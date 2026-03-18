/**
 * batch/routing-config.ts — Feature flags and routing logic for batch vs sync execution.
 *
 * Controls which job types are routed through the OpenAI Batch API (50% cost savings)
 * vs executed synchronously via callAIWithFailover.
 *
 * v3: ROLLBACK — GPT-5.x models have 100% batch failure rate (confirmed production data Mar 2026).
 *     gpt-5.4-mini: 1464 failed, 0 completed.
 *     gpt-5-mini:   28016 failed, 0 completed.
 *     gpt-4o-mini:  32914 completed, 53 failed — ONLY working batch model.
 *     BATCH_DEFAULT_MODEL reverted to gpt-4o-mini.
 */

// providerForModel no longer needed — hard guard uses allowlist only

/** Per-job-type batch routing flags. Set to true to activate batch path. */
const BATCH_ROUTING_FLAGS: Record<string, boolean> = {
  lesson_generate_content: true,
  package_generate_exam_pool: true,
  expand_handbook_section: true,
  package_generate_handbook: true,
  package_generate_oral_exam: true,
  package_generate_lesson_minichecks: true,
  package_generate_glossary: true,
};

/** Default model for batch processing — ONLY gpt-4o-mini is production-verified */
export const BATCH_DEFAULT_MODEL = "gpt-4o-mini";

/**
 * HARD GUARD: Only explicitly verified batch-compatible models are allowed.
 *
 * PRODUCTION EVIDENCE (Mar 2026):
 *   gpt-4o-mini   — 32,914 completed, 53 failed (99.8% success) ✅
 *   gpt-5-mini    — 0 completed, 28,016 failed (0% success) ❌
 *   gpt-5.4-mini  — 0 completed, 1,464 failed (0% success) ❌
 *   gpt-5.4-nano  — model_not_found for batch variant ❌
 *
 * DO NOT add gpt-5.x models until OpenAI confirms batch support and
 * a canary test shows >95% success rate.
 */
const BATCH_ALLOWED_MODELS = new Set([
  "gpt-4o-mini",
]);

export function batchSafeModel(model: string): string {
  if (BATCH_ALLOWED_MODELS.has(model)) return model;

  // Hard reject — log and return default instead of silently accepting broken models
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
