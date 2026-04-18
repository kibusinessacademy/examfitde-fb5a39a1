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
  // Pool-Fill (LLM-driven gap repair) — added 2026-04-17
  "pool_fill_bloom_gaps",
  "pool_fill_competency_gaps",
  "pool_fill_lf_gaps",
  // Lesson generation (all variants) — added 2026-04-17
  "lesson_generate_content",
  "lesson_generate_competency_bundle",
  // Blueprint variant generation (LLM) — added 2026-04-17
  "blueprint_generate_variants",
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
  // Pool-Fill (Heal/Backfill) — LLM-Generierung von fehlenden Bloom-Tax-Fragen
  "pool_fill_bloom_gaps",
  "pool_fill_competency_gaps",
  "pool_fill_lf_gaps",
  // Lesson Backfill
  "lesson_generate_competency_bundle",
  "lesson_generate_content",
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
  if (totalSlots <= 2) return { control: 1, recovery: 1, generation: 0 };
  if (totalSlots <= 3) return { control: 1, recovery: 1, generation: 1 };
  if (totalSlots <= 4) return { control: 1, recovery: 2, generation: 1 };

  // Recovery lane minimum raised from 1→10 (2026-04-18) to clear stuck-package backlog.
  // Recovery jobs are cheap (heal/reconcile/repair) — safe at high concurrency.
  const recoveryMin = Math.min(10, totalSlots - 2);
  const controlSlots = Math.max(1, Math.floor(totalSlots * 0.3));
  const recoverySlots = Math.max(recoveryMin, Math.floor(totalSlots * 0.3));
  const generationSlots = Math.max(1, totalSlots - controlSlots - recoverySlots);

  return {
    control: controlSlots,
    recovery: recoverySlots,
    generation: generationSlots,
  };
}

/**
 * SSOT: Per-Job-Type Tick-Capacity Caps.
 *
 * Limits how many jobs of a single heavy job_type may be claimed in ONE tick.
 * Prevents Tick-Capacity-Overflow where 7-8 heavy jobs serialised in 110s
 * Edge runtime crash the runner before it can persist `status=completed`.
 *
 * Background: package_run_integrity_check takes ~10-15s each. 8 in one tick
 * = 80-120s ≥ 110s Edge limit → runner pod aborts → jobs stuck in `processing`.
 *
 * Add a job_type here when forensic evidence shows the same overflow pattern
 * (multiple jobs claimed in same ms-tick, lock_age > Edge timeout, no completion).
 */
export const PER_TYPE_TICK_CAPS: Record<string, number> = {
  // Heavy artifact-validating jobs (10-20s each, fan-out over many records)
  package_run_integrity_check: 2,
  package_quality_council: 2,
  package_validate_exam_pool: 3,
  package_validate_handbook_depth: 3,
  package_elite_harden: 2,
  package_repair_exam_pool_quality: 2,
};

/**
 * SSOT: Estimated runtime per heavy job_type (seconds).
 *
 * Used by the Heavy-Job-Budget guard to cap cumulative tick runtime BEFORE
 * Edge-Runtime hard-kills the runner pod. Values are conservative p95 from
 * ai_usage_log + edge_function_logs forensics (2026-04-16 incident window).
 *
 * Anything not listed here is treated as 0s (cheap control/recovery jobs).
 */
export const ESTIMATED_RUNTIME_SECONDS: Record<string, number> = {
  package_run_integrity_check: 15,
  package_quality_council: 15,
  package_validate_exam_pool: 8,
  package_validate_handbook_depth: 8,
  package_elite_harden: 20,
  package_repair_exam_pool_quality: 18,
  package_generate_handbook: 25,
  handbook_expand_section: 20,
  package_generate_exam_pool: 30,
  package_generate_lesson_minichecks: 18,
  package_generate_blueprint_variants: 22,
  package_generate_oral_exam: 15,
  package_generate_glossary: 12,
  package_fanout_learning_content: 10,
  package_generate_learning_content: 25,
  lesson_generate_content_shard: 15,
  lesson_generate_content: 20,
  lesson_generate_competency_bundle: 25,
  blueprint_generate_variants: 22,
  pool_fill_bloom_gaps: 20,
  pool_fill_competency_gaps: 20,
  pool_fill_lf_gaps: 20,
  generate_course: 20,
  extract_curriculum: 18,
};

/**
 * SSOT: Heavy Job Tick Budget (seconds).
 *
 * Hard ceiling for cumulative estimated runtime of all jobs claimed in ONE tick.
 * Set ~20% below the Edge-Runtime hard limit (110s) to leave headroom for
 * dispatch overhead, DB writes, and heartbeat noise.
 *
 * If sum(ESTIMATED_RUNTIME_SECONDS[job.type]) > BUDGET, surplus jobs are
 * deferred — even if PER_TYPE_TICK_CAPS would have allowed them.
 *
 * This is the secondary guard that catches:
 *   - new heavy job types not yet in PER_TYPE_TICK_CAPS
 *   - mixed-load ticks (1× integrity + 2× exam-pool gen + 1× elite_harden)
 *   - cap miscalibration after pipeline expansion
 */
export const HEAVY_JOB_TICK_BUDGET_SECONDS = 85;

/**
 * Apply the Heavy-Job-Budget after per-type caps.
 * Walks jobs in order and stops admitting once the cumulative estimate
 * crosses HEAVY_JOB_TICK_BUDGET_SECONDS.
 *
 * Cheap jobs (estimate=0) are always admitted — they can't trigger overflow.
 */
export function enforceHeavyJobBudget<T extends { job_type: string }>(
  jobs: T[],
  budgetSeconds: number = HEAVY_JOB_TICK_BUDGET_SECONDS,
): { kept: T[]; deferred: T[]; estimatedSeconds: number } {
  const kept: T[] = [];
  const deferred: T[] = [];
  let used = 0;
  for (const job of jobs) {
    const cost = ESTIMATED_RUNTIME_SECONDS[job.job_type] ?? 0;
    if (cost === 0) {
      kept.push(job);
      continue;
    }
    if (used + cost > budgetSeconds) {
      deferred.push(job);
      continue;
    }
    kept.push(job);
    used += cost;
  }
  return { kept, deferred, estimatedSeconds: used };
}

/**
 * Apply per-type caps to a list of claimed jobs.
 * Returns { kept, deferred } where `deferred` jobs MUST be released back to
 * pending by the caller (status=pending, locked_at=NULL, run_after=now+5s).
 */
export function enforcePerTypeCaps<T extends { job_type: string }>(
  jobs: T[],
): { kept: T[]; deferred: T[] } {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const deferred: T[] = [];
  for (const job of jobs) {
    const cap = PER_TYPE_TICK_CAPS[job.job_type];
    if (cap === undefined) {
      kept.push(job);
      continue;
    }
    const seen = counts.get(job.job_type) ?? 0;
    if (seen >= cap) {
      deferred.push(job);
    } else {
      kept.push(job);
      counts.set(job.job_type, seen + 1);
    }
  }
  return { kept, deferred };
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
