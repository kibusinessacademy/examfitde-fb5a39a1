/**
 * ai-gateway/policies.ts — Policy SSOT for AI generation governance.
 *
 * Code-side defaults; DB table `ai_generation_policies` can override at runtime.
 *
 * v18: Primary models upgraded to gpt-5.4-mini / gpt-5.4-nano.
 *      gpt-4o-mini retained as batch-safe fallback.
 */

import type { AIGenerationPolicy } from "./types.ts";

/** Hard-coded policy defaults — DB overrides win when present. */
export const DEFAULT_POLICIES: Record<string, AIGenerationPolicy> = {
  lesson_generate_content: {
    jobType: "lesson_generate_content",
    enabled: true,
    preferBatch: true,
    allowSync: true,
    requireDeficit: true,
    useCache: true,
    templateFirst: false,
    maxRetries: 1,
    maxTokensOut: 1400,
    maxBatchSize: 500,
    allowedModels: ["gpt-5.4-mini", "gpt-4o-mini"],
    defaultModel: "gpt-5.4-mini",
    batchRolloutPct: 100,
  },
  package_generate_exam_pool: {
    jobType: "package_generate_exam_pool",
    enabled: true,
    preferBatch: true,
    allowSync: false,
    requireDeficit: true,
    useCache: true,
    templateFirst: true,
    maxRetries: 1,
    maxTokensOut: 900,
    maxBatchSize: 5000,
    allowedModels: ["gpt-5.4-mini", "gpt-4o-mini", "gpt-5-mini"],
    defaultModel: "gpt-5.4-mini",
    batchRolloutPct: 100,
  },
  // P4 FIX: canonical name is "handbook_expand_section" (matches pipeline/job-map SSOT)
  handbook_expand_section: {
    jobType: "handbook_expand_section",
    enabled: true,
    preferBatch: true,
    allowSync: true,
    requireDeficit: true,
    useCache: true,
    templateFirst: false,
    maxRetries: 1,
    maxTokensOut: 2600,
    maxBatchSize: 200,
    allowedModels: ["gpt-5.4-mini", "gpt-4o-mini", "gpt-4.1"],
    defaultModel: "gpt-5.4-mini",
    batchRolloutPct: 100,
  },
  package_generate_oral_exam: {
    jobType: "package_generate_oral_exam",
    enabled: true,
    preferBatch: true,
    allowSync: true,
    requireDeficit: true,
    useCache: false,
    templateFirst: false,
    maxRetries: 1,
    maxTokensOut: 1200,
    maxBatchSize: 200,
    allowedModels: ["gpt-5.4-mini", "gpt-4o-mini"],
    defaultModel: "gpt-5.4-mini",
    batchRolloutPct: 100,
  },
  package_generate_lesson_minichecks: {
    jobType: "package_generate_lesson_minichecks",
    enabled: true,
    preferBatch: true,
    allowSync: true,
    requireDeficit: true,
    useCache: true,
    templateFirst: true,
    maxRetries: 1,
    maxTokensOut: 800,
    maxBatchSize: 500,
    allowedModels: ["gpt-5.4-nano", "gpt-4o-mini"],
    defaultModel: "gpt-5.4-nano",
    batchRolloutPct: 100,
  },
  package_generate_glossary: {
    jobType: "package_generate_glossary",
    enabled: true,
    preferBatch: true,
    allowSync: true,
    requireDeficit: true,
    useCache: true,
    templateFirst: false,
    maxRetries: 1,
    maxTokensOut: 1000,
    maxBatchSize: 200,
    allowedModels: ["gpt-5.4-nano", "gpt-4o-mini"],
    defaultModel: "gpt-5.4-nano",
    batchRolloutPct: 100,
  },
};

/**
 * Resolve policy: DB row wins, then code default, then safe fallback.
 */
export async function resolvePolicy(
  sb: any,
  jobType: string,
): Promise<AIGenerationPolicy> {
  // Try DB first
  try {
    const { data } = await sb
      .from("ai_generation_policies")
      .select("*")
      .eq("job_type", jobType)
      .maybeSingle();

    if (data) {
      return {
        jobType: data.job_type,
        enabled: data.is_enabled ?? true,
        preferBatch: data.prefer_batch ?? false,
        allowSync: data.allow_sync ?? true,
        requireDeficit: data.require_deficit ?? true,
        useCache: data.use_cache ?? true,
        templateFirst: data.template_first ?? false,
        maxRetries: data.max_retries ?? 1,
        maxTokensOut: data.max_tokens_out ?? undefined,
        maxBatchSize: data.max_batch_size ?? undefined,
        allowedModels: data.allowed_models ?? [],
        defaultModel: data.default_model ?? "gpt-5.4-mini",
        dailyBudgetEur: data.daily_budget_eur ?? undefined,
        batchRolloutPct: data.batch_rollout_pct ?? 100,
      };
    }
  } catch {
    // DB read failed — fall through to code defaults
  }

  return DEFAULT_POLICIES[jobType] ?? {
    jobType,
    enabled: true,
    preferBatch: false,
    allowSync: true,
    requireDeficit: false,
    useCache: false,
    templateFirst: false,
    maxRetries: 1,
    allowedModels: ["gpt-5.4-mini", "gpt-4o-mini"],
    defaultModel: "gpt-5.4-mini",
    batchRolloutPct: 100,
  };
}
