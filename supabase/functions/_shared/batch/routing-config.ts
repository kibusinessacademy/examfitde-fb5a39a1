/**
 * batch/routing-config.ts — Feature flags and routing logic for batch vs sync execution.
 *
 * Controls which job types are routed through the OpenAI Batch API (50% cost savings)
 * vs executed synchronously via callAIWithFailover.
 *
 * Dual-path: sync fallback always available. Batch mode activated per job_type.
 */

import { providerForModel } from "../model-catalog.ts";

/** Per-job-type batch routing flags. Set to true to activate batch path. */
const BATCH_ROUTING_FLAGS: Record<string, boolean> = {
  lesson_generate_content: true,
  package_generate_exam_pool: true,
  // Phase 3 candidates (not yet activated):
  expand_handbook_section: false,
  package_generate_handbook: false,
  package_generate_oral_exam: false,
  package_generate_lesson_minichecks: false,
  package_generate_glossary: false,
};

/** Default model for batch processing (batch pricing applies) */
export const BATCH_DEFAULT_MODEL = "gpt-4o-mini";

/** Model for exam pool batch (needs stronger reasoning) */
export const BATCH_EXAM_MODEL = "gpt-5-mini";

/** Fallback mapping: when a non-OpenAI model is selected for batch, remap to OpenAI equivalent */
const BATCH_MODEL_REMAP: Record<string, string> = {
  "claude-haiku-4-5-20251001": "gpt-4o-mini",
  "claude-3-5-haiku-20241022": "gpt-4o-mini",
  "claude-sonnet-4-5-20250929": "gpt-5-mini",
};

/**
 * Ensure a model is batch-compatible (OpenAI only in Phase A).
 * If the model is from a non-OpenAI provider, remap to an equivalent OpenAI model.
 * Returns the original model if already compatible.
 */
export function batchSafeModel(model: string): string {
  // Already OpenAI-compatible
  if (providerForModel(model) === "openai") return model;

  // Known remap
  const remapped = BATCH_MODEL_REMAP[model];
  if (remapped) {
    console.log(`[batch-routing] MODEL_REMAP: ${model} → ${remapped} (batch requires OpenAI)`);
    return remapped;
  }

  // Unknown non-OpenAI model — fall back to default
  console.warn(`[batch-routing] UNKNOWN_MODEL_REMAP: ${model} → ${BATCH_DEFAULT_MODEL} (no remap entry)`);
  return BATCH_DEFAULT_MODEL;
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
  return {
    model,
    messages,
    temperature: opts?.temperature ?? 0.7,
    max_tokens: opts?.max_tokens ?? 4096,
    ...(opts?.response_format ? { response_format: opts.response_format } : {}),
  };
}
