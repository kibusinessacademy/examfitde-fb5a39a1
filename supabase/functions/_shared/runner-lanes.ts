/**
 * SSOT: Runner Lane Classification (Phase 1)
 *
 * Separates job types into 3 lanes with fixed dispatch priority:
 *   1. CONTROL  — gate/validate/finalize jobs that unblock progress
 *   2. RECOVERY — heal/repair/reconcile jobs that fix state
 *   3. GENERATION — LLM content generation jobs (heaviest)
 *
 * Control Lane must NEVER be starved by Generation Lane.
 * Recovery Lane runs before Generation to unblock finalization.
 */

export type RunnerLane = "control" | "recovery" | "generation";

/** Dispatch order: control first, recovery second, generation last */
export const LANE_DISPATCH_ORDER: RunnerLane[] = ["control", "recovery", "generation"];

// ── CONTROL LANE ──
// All jobs that validate, finalize, gate, or enqueue — no LLM calls, fast DB ops.
const CONTROL_JOB_TYPES = new Set([
  // Validators
  "package_validate_learning_content",
  "package_validate_exam_pool",
  "package_validate_handbook",
  "package_validate_handbook_depth",
  "package_validate_oral_exam",
  "package_validate_tutor_index",
  "package_validate_lesson_minichecks",
  "package_validate_blueprint_variants",
  "package_validate_blueprints",           // P2 FIX: was missing
  // Promoters / Finalizers
  "package_promote_blueprint_variants",
  "package_finalize_learning_content",
  "package_auto_publish",
  "package_quality_council",
  // Enqueuers / Scaffolders
  "package_enqueue_handbook_expand",
  "package_scaffold_learning_course",
  // Integrity / Rebalance
  "package_run_integrity_check",
  "package_exam_rebalance",
  // Tutor index (DB indexing, not LLM)
  "package_build_ai_tutor_index",          // P2 FIX: was missing
  // Course-level finalizer
  "course_finalize",
  "post_validation",
  "quality_gate_precheck",
  "publish_product",
  // Council steps (read-only gate logic)
  "council_propose_step",
  "council_critique_step",
  "council_vote_and_verdict",
  "council_publish_step",
  "council_recompute_course_ready",
  "council_run_step",
]);

// ── RECOVERY LANE ──
// Repair, reconcile, heal — must not be blocked by generation load.
const RECOVERY_JOB_TYPES = new Set([
  "package_repair_exam_pool_quality",
  "package_repair_minichecks",
  "package_repair_failed_lessons",
  "repair_learning_content",
  "regenerate_learning_content_cluster",
  // Seeding/recheck (state-correction)
  "seed_learning_fields",
  "seed_competencies",
  "seed_recheck",
  // Reconciliation
  "reconcile_store_purchases",
  "expire_store_subscriptions",
  // LTI passback
  "process_lti_grade_passback",
  // QC worker (full integrity scan)
  "qc_worker_full",
]);

// ── GENERATION LANE ──
// Everything with LLM calls or heavy content creation — gets remaining budget.
const GENERATION_JOB_TYPES_LANE = new Set([
  "package_generate_handbook",
  "handbook_expand_section",
  "package_generate_exam_pool",
  "package_auto_seed_exam_blueprints",
  "package_generate_lesson_minichecks",
  "lesson_generate_content_shard",
  "package_generate_blueprint_variants",
  "package_generate_oral_exam",
  "package_elite_harden",
  "package_generate_glossary",              // P2 FIX: was missing
  "package_fanout_learning_content",        // P2 FIX: was missing
  "package_generate_learning_content",      // P2 FIX: was missing
  // Root dispatchers
  "generate_course",
  "extract_curriculum",
  "seed_exam_questions",
  "enrich_exam_solutions",
  "upgrade_minichecks_v1",
  // SEO generation
  "seo_foundation",
  "seo_audit",
  "seo_internal_links",
  "seo_generate",
  "seo_qc_check",
  "seo_sitemap_refresh",
  // IHK upgrade
  "upgrade_ihk",
  // Curriculum smoke
  "curriculum_smoke",
]);

/**
 * Return all known job types for a given lane.
 * Used by lane-aware claiming to scope DB queries per lane.
 */
export function jobTypesForLane(lane: RunnerLane): string[] {
  switch (lane) {
    case "control": return [...CONTROL_JOB_TYPES];
    case "recovery": return [...RECOVERY_JOB_TYPES];
    case "generation": return [...GENERATION_JOB_TYPES_LANE];
  }
}

/**
 * Classify a job type into its runner lane.
 * Unknown job types default to "control" (safe: they get priority dispatch).
 */
export function laneForJobType(jobType: string): RunnerLane {
  if (RECOVERY_JOB_TYPES.has(jobType)) return "recovery";
  if (GENERATION_JOB_TYPES_LANE.has(jobType)) return "generation";
  if (CONTROL_JOB_TYPES.has(jobType)) return "control";
  // Default: unknown jobs go to control (safe — they get dispatched first)
  // WARNING: log unknown types so we catch misclassifications early
  console.warn(`[runner-lanes] UNKNOWN_JOB_TYPE_DEFAULTED: "${jobType}" → control (add to SSOT!)`);
  return "control";
}

/**
 * Sort jobs into lane buckets in dispatch order.
 */
export function partitionByLane<T extends { job_type: string }>(
  jobs: T[],
): Record<RunnerLane, T[]> {
  const result: Record<RunnerLane, T[]> = {
    control: [],
    recovery: [],
    generation: [],
  };
  for (const job of jobs) {
    result[laneForJobType(job.job_type)].push(job);
  }
  return result;
}

/** Lane-level budget allocation from total claim slots */
export interface LaneBudget {
  control: number;
  recovery: number;
  generation: number;
}

/**
 * Allocate dispatch slots per lane from a total budget.
 * Control gets priority, Recovery gets guaranteed minimum, Generation gets rest.
 */
export function allocateLaneBudgets(totalSlots: number): LaneBudget {
  if (totalSlots <= 1) return { control: 1, recovery: 0, generation: 0 };
  if (totalSlots <= 2) return { control: 1, recovery: 0, generation: 1 };
  if (totalSlots <= 3) return { control: 1, recovery: 1, generation: 1 };
  if (totalSlots <= 4) return { control: 2, recovery: 1, generation: 1 };

  const controlSlots = Math.max(1, Math.floor(totalSlots * 0.4));
  const recoverySlots = Math.max(1, Math.floor(totalSlots * 0.2));
  const generationSlots = Math.max(1, totalSlots - controlSlots - recoverySlots);

  return {
    control: controlSlots,
    recovery: recoverySlots,
    generation: generationSlots,
  };
}

/**
 * Redistribute unused lane slots to active lanes.
 * E.g. job-runner skips generation → those slots go to control+recovery.
 * content-runner skips control+recovery → those slots go to generation.
 */
export function redistributeLaneBudgets(
  base: LaneBudget,
  activeLanes: RunnerLane[],
): LaneBudget {
  const activeSet = new Set(activeLanes);
  let freed = 0;
  const result = { ...base };

  // Collect slots from inactive lanes
  for (const lane of (["control", "recovery", "generation"] as RunnerLane[])) {
    if (!activeSet.has(lane)) {
      freed += result[lane];
      result[lane] = 0;
    }
  }

  if (freed <= 0 || activeLanes.length === 0) return result;

  // Distribute freed slots proportionally to active lanes
  const totalActive = activeLanes.reduce((s, l) => s + result[l], 0);
  let distributed = 0;
  for (let i = 0; i < activeLanes.length; i++) {
    const lane = activeLanes[i];
    const share = i === activeLanes.length - 1
      ? freed - distributed
      : Math.round((result[lane] / Math.max(1, totalActive)) * freed);
    result[lane] += share;
    distributed += share;
  }

  return result;
}
