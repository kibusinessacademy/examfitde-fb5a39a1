/**
 * SSOT: Pipeline StepKey → JobType mapping.
 *
 * Both pipeline-runner and stuck-scan MUST import from here.
 * Adding a new step? Add it here — nowhere else.
 */

export type PipelineStepKey =
  | "scaffold_learning_course"
  | "generate_glossary"
  | "generate_learning_content"
  | "validate_learning_content"
  | "auto_seed_exam_blueprints"
  | "validate_blueprints"
  | "generate_exam_pool"
  | "validate_exam_pool"
  | "build_ai_tutor_index"
  | "validate_tutor_index"
  | "generate_oral_exam"
  | "validate_oral_exam"
  | "generate_lesson_minichecks"
  | "validate_lesson_minichecks"
  | "generate_handbook"
  | "validate_handbook"
  | "elite_harden"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

/** Maps step_key → job_type in job_queue */
export const STEP_TO_JOB_TYPE: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "package_scaffold_learning_course",
  generate_glossary: "package_generate_glossary",
  generate_learning_content: "package_generate_learning_content",
  validate_learning_content: "package_validate_learning_content",
  auto_seed_exam_blueprints: "package_auto_seed_exam_blueprints",
  validate_blueprints: "package_validate_blueprints",
  generate_exam_pool: "package_generate_exam_pool",
  validate_exam_pool: "package_validate_exam_pool",
  build_ai_tutor_index: "package_build_ai_tutor_index",
  validate_tutor_index: "package_validate_tutor_index",
  generate_oral_exam: "package_generate_oral_exam",
  validate_oral_exam: "package_validate_oral_exam",
  generate_lesson_minichecks: "package_generate_lesson_minichecks",
  validate_lesson_minichecks: "package_validate_lesson_minichecks",
  generate_handbook: "package_generate_handbook",
  validate_handbook: "package_validate_handbook",
  elite_harden: "package_elite_harden",
  run_integrity_check: "package_run_integrity_check",
  quality_council: "package_quality_council",
  auto_publish: "package_auto_publish",
};

/**
 * Canonical step ordering — superset of all possible steps.
 * Steps not present in a package's DB rows are simply skipped.
 */
export const FULL_STEP_ORDER: PipelineStepKey[] = [
  "scaffold_learning_course",
  "generate_glossary",
  "generate_learning_content",
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_exam_pool",
  "validate_exam_pool",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

// ═══════════════════════════════════════════════════════════════
// Worker Pool Routing (SSOT)
// ═══════════════════════════════════════════════════════════════

export type WorkerPool = "core" | "content";

/**
 * SSOT routing table.
 * Anything heavy/LLM-batch/timeout-prone MUST go to content pool.
 * Everything else defaults to core.
 */
export const JOB_POOLS: Record<string, WorkerPool> = {
  // ── content / heavy ─────────────────────────────────────────
  package_generate_learning_content: "content",
  package_generate_handbook:         "content",
  package_generate_glossary:         "content",
  package_generate_oral_exam:        "content",
  package_generate_lesson_minichecks:"content",
  mass_enrich_competencies_v2:       "content",

  // ── core / orchestration + validation (explicit for clarity) ─
  pipeline_tick:                     "core",
  stuck_scan:                        "core",
  package_scaffold_learning_course:  "core",
  package_validate_blueprints:       "core",
  package_validate_exam_pool:        "core",
  package_validate_learning_content: "core",
  package_validate_oral_exam:        "core",
  package_validate_tutor_index:      "core",
  package_validate_lesson_minichecks:"core",
  package_validate_handbook:         "core",
  package_auto_seed_exam_blueprints: "core",
  package_generate_exam_pool:        "core",
  package_build_ai_tutor_index:      "core",
  package_elite_harden:              "core",
  package_run_integrity_check:       "core",
  package_quality_council:           "core",
  package_auto_publish:              "core",
};

/** Returns the correct worker pool for a given job type. Defaults to "core". */
export function poolForJobType(jobType: string): WorkerPool {
  return JOB_POOLS[jobType] ?? "core";
}

/** Backoff heuristic for stale/failed job requeues */
export function inferBackoffSeconds(reason: string | number): number {
  if (typeof reason === "number") {
    // Called with attempt count — exponential backoff
    return Math.min(300, 30 * Math.pow(1.5, reason));
  }
  const r = (reason || "").toLowerCase();
  if (!r) return 30;
  if (r.includes("rate limit") || r.includes("429")) return 120;
  if (r.includes("timeout") || r.includes("504") || r.includes("deadline")) return 90;
  if (r.includes("unknown") || r.includes("edge") || r.includes("worker job failed")) return 60;
  // Job-type aware: heavy generators get longer cooldown
  if (r.includes("elite_harden") || r.includes("generate_exam") || r.includes("generate_learning")) return 60;
  if (r.includes("generate_") || r.includes("scaffold_")) return 45;
  return 30;
}
