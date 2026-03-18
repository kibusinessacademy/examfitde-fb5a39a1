/**
 * batch/routing-config.ts — Feature flags and routing logic for batch vs sync execution.
 *
 * Controls which job types are routed through the OpenAI Batch API (50% cost savings)
 * vs executed synchronously via callAIWithFailover.
 *
 * v4: HARD GOVERNANCE + CANARY INFRASTRUCTURE
 *     - Production: ONLY gpt-4o-mini allowed
 *     - Canary: Isolated test path for GPT-5.x validation
 *     - Auto-remap: Non-allowed models silently forced to gpt-4o-mini with telemetry
 *     - Every remap event logged for forensic audit
 *
 * PRODUCTION EVIDENCE (Mar 2026):
 *     gpt-4o-mini:  32,914 completed, 53 failed (99.8% success) ✅
 *     gpt-5-mini:   0 completed, 28,016 failed (0% success) ❌
 *     gpt-5.4-mini: 0 completed, 1,464 failed (0% success) ❌
 */

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
 * DO NOT add gpt-5.x models until a canary test shows >95% success rate.
 */
const BATCH_ALLOWED_MODELS = new Set([
  "gpt-4o-mini",
]);

/**
 * CANARY ALLOWLIST: Models under isolated batch testing.
 * These are ONLY allowed when explicitly flagged as canary requests.
 * Results are tracked separately and do NOT affect production pipelines.
 */
const BATCH_CANARY_MODELS = new Set<string>([
  // Uncomment to begin canary testing:
  // "gpt-5.4-mini",
]);

/** Tracks remap events for this execution context (edge function invocation). */
const _remapLog: Array<{ from: string; to: string; ts: string; reason: string }> = [];

export function getRemapLog() {
  return [..._remapLog];
}

/**
 * Ensure model is batch-safe. Non-allowed models are auto-remapped to BATCH_DEFAULT_MODEL.
 * Every remap is logged for forensic audit.
 */
export function batchSafeModel(model: string, opts?: { isCanary?: boolean }): string {
  // Production allowlist
  if (BATCH_ALLOWED_MODELS.has(model)) return model;

  // Canary allowlist (only if explicitly flagged)
  if (opts?.isCanary && BATCH_CANARY_MODELS.has(model)) {
    console.warn(`[batch-governance] CANARY_MODEL_ACCEPTED: "${model}" — isolated test path`);
    return model;
  }

  // Auto-remap with telemetry
  const reason = BATCH_CANARY_MODELS.has(model) && !opts?.isCanary
    ? `canary model "${model}" used without isCanary flag`
    : `model "${model}" not in BATCH_ALLOWED_MODELS`;

  const entry = { from: model, to: BATCH_DEFAULT_MODEL, ts: new Date().toISOString(), reason };
  _remapLog.push(entry);

  console.error(
    `[batch-governance] BATCH_MODEL_REMAPPED: "${model}" → "${BATCH_DEFAULT_MODEL}". ` +
    `Reason: ${reason}. Allowed: [${[...BATCH_ALLOWED_MODELS].join(", ")}]`
  );
  return BATCH_DEFAULT_MODEL;
}

/**
 * Strict validation: throws if model is not batch-allowed.
 * Use in gateway/enqueue paths where a 422 response is appropriate.
 */
export function assertBatchModel(model: string): void {
  if (!BATCH_ALLOWED_MODELS.has(model)) {
    throw new Error(
      `BATCH_MODEL_NOT_ALLOWED: "${model}" rejected. ` +
      `Production-verified: [${[...BATCH_ALLOWED_MODELS].join(", ")}]. ` +
      `Canary: [${[...BATCH_CANARY_MODELS].join(", ") || "none"}].`
    );
  }
}

/**
 * Check if a model is eligible for canary batch testing.
 */
export function isCanaryBatchModel(model: string): boolean {
  return BATCH_CANARY_MODELS.has(model) && !BATCH_ALLOWED_MODELS.has(model);
}

/**
 * Determine if a job should use the batch path.
 */
export function shouldUseBatch(
  jobType: string,
  opts?: {
    forceSyncMode?: boolean;
    urgency?: "low" | "normal" | "high";
    itemCount?: number;
  },
): boolean {
  if (opts?.forceSyncMode) return false;
  if (opts?.urgency === "high") return false;

  const enabled = BATCH_ROUTING_FLAGS[jobType];
  if (!enabled) return false;

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
 * CRITICAL: Ensures correct token parameter for the target model.
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
