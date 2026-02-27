/**
 * SSOT: Pipeline StepKey → JobType mapping + Worker Pool routing + Edge Function dispatch.
 *
 * Both pipeline-runner, job-runner, content-runner and stuck-scan MUST import from here.
 * Adding a new step or job? Add it here — nowhere else.
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
// Unified Job Definitions (SSOT for pool + edge function dispatch)
// ═══════════════════════════════════════════════════════════════

export type WorkerPool = "core" | "content";

export interface JobDefinition {
  pool: WorkerPool;
  /** Edge function name to dispatch to. Only needed for content-runner dispatched jobs. */
  edgeFunction?: string;
}

/**
 * SSOT job definition table.
 * Pool routing AND edge function dispatch in ONE place — no drift possible.
 */
export const JOB_DEFINITIONS: Record<string, JobDefinition> = {
  // ── content / heavy ─────────────────────────────────────────
  package_generate_learning_content: { pool: "content", edgeFunction: "package-generate-learning-content" },
  package_generate_handbook:         { pool: "content", edgeFunction: "package-generate-handbook" },
  package_generate_glossary:         { pool: "content", edgeFunction: "package-generate-glossary" },
  package_generate_oral_exam:        { pool: "content", edgeFunction: "package-generate-oral-exam" },
  package_generate_lesson_minichecks:{ pool: "content", edgeFunction: "package-generate-lesson-minichecks" },
  mass_enrich_competencies_v2:       { pool: "content", edgeFunction: "mass-enrich-competencies" },

  // ── core / orchestration + validation (explicit for clarity) ─
  pipeline_tick:                     { pool: "core" },
  stuck_scan:                        { pool: "core" },
  package_scaffold_learning_course:  { pool: "core" },
  package_validate_blueprints:       { pool: "core" },
  package_validate_exam_pool:        { pool: "core" },
  package_validate_learning_content: { pool: "core" },
  package_validate_oral_exam:        { pool: "core" },
  package_validate_tutor_index:      { pool: "core" },
  package_validate_lesson_minichecks:{ pool: "core" },
  package_validate_handbook:         { pool: "core" },
  package_auto_seed_exam_blueprints: { pool: "core" },
  package_generate_exam_pool:        { pool: "core" },
  package_build_ai_tutor_index:      { pool: "core" },
  package_elite_harden:              { pool: "core" },
  package_run_integrity_check:       { pool: "core" },
  package_quality_council:           { pool: "core" },
  package_auto_publish:              { pool: "core" },
};

// ── Backward-compatible derived maps (used by existing code) ──

/** @deprecated Use JOB_DEFINITIONS instead. Kept for backward compat. */
export const JOB_POOLS: Record<string, WorkerPool> = Object.fromEntries(
  Object.entries(JOB_DEFINITIONS).map(([k, v]) => [k, v.pool])
);

/** Returns the correct worker pool for a given job type. Defaults to "core". */
export function poolForJobType(jobType: string): WorkerPool {
  return JOB_DEFINITIONS[jobType]?.pool ?? "core";
}

/** Returns the edge function name for a given job type, or null if not dispatched. */
export function edgeFunctionForJobType(jobType: string): string | null {
  return JOB_DEFINITIONS[jobType]?.edgeFunction ?? null;
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
