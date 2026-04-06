/**
 * SSOT: Pipeline StepKey → JobType mapping + Worker Pool routing + Edge Function dispatch.
 *
 * Both pipeline-runner, job-runner, content-runner and stuck-scan MUST import from here.
 * Adding a new step or job? Add it here — nowhere else.
 */

export type PipelineStepKey =
  | "scaffold_learning_course"
  | "generate_glossary"
  | "fanout_learning_content"
  | "generate_learning_content"
  | "finalize_learning_content"
  | "validate_learning_content"
  | "auto_seed_exam_blueprints"
  | "validate_blueprints"
  | "generate_blueprint_variants"
  | "validate_blueprint_variants"
  | "promote_blueprint_variants"
  | "generate_exam_pool"
  | "validate_exam_pool"
  | "repair_exam_pool_quality"
  | "build_ai_tutor_index"
  | "validate_tutor_index"
  | "generate_oral_exam"
  | "validate_oral_exam"
  | "generate_lesson_minichecks"
  | "validate_lesson_minichecks"
  | "generate_handbook"
  | "validate_handbook"
  | "enqueue_handbook_expand"
  | "expand_handbook"
  | "validate_handbook_depth"
  | "elite_harden"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

/** Maps step_key → job_type in job_queue */
export const STEP_TO_JOB_TYPE: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "package_scaffold_learning_course",
  generate_glossary: "package_generate_glossary",
  fanout_learning_content: "package_fanout_learning_content",
  generate_learning_content: "package_generate_learning_content",
  finalize_learning_content: "package_finalize_learning_content",
  validate_learning_content: "package_validate_learning_content",
  auto_seed_exam_blueprints: "package_auto_seed_exam_blueprints",
  validate_blueprints: "package_validate_blueprints",
  generate_blueprint_variants: "package_generate_blueprint_variants",
  validate_blueprint_variants: "package_validate_blueprint_variants",
  promote_blueprint_variants: "package_promote_blueprint_variants",
  generate_exam_pool: "package_generate_exam_pool",
  validate_exam_pool: "package_validate_exam_pool",
  repair_exam_pool_quality: "package_repair_exam_pool_quality",
  build_ai_tutor_index: "package_build_ai_tutor_index",
  validate_tutor_index: "package_validate_tutor_index",
  generate_oral_exam: "package_generate_oral_exam",
  validate_oral_exam: "package_validate_oral_exam",
  generate_lesson_minichecks: "package_generate_lesson_minichecks",
  validate_lesson_minichecks: "package_validate_lesson_minichecks",
  generate_handbook: "package_generate_handbook",
  validate_handbook: "package_validate_handbook",
  enqueue_handbook_expand: "package_enqueue_handbook_expand",
  expand_handbook: "handbook_expand_section",
  validate_handbook_depth: "package_validate_handbook_depth",
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
  "fanout_learning_content",
  "generate_learning_content",
  "finalize_learning_content",
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_blueprint_variants",
  "validate_blueprint_variants",
  "promote_blueprint_variants",
  "generate_exam_pool",
  "validate_exam_pool",
  "repair_exam_pool_quality",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "enqueue_handbook_expand",
  "expand_handbook",
  "validate_handbook_depth",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

// ═══════════════════════════════════════════════════════════════
// Bloom Taxonomy Allowlist (SSOT — used by CI Guard 13)
// ═══════════════════════════════════════════════════════════════

export const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

// ═══════════════════════════════════════════════════════════════
// Fan-Out SSOT — Centralized subjob decomposition config
// ═══════════════════════════════════════════════════════════════

/**
 * Completion mode for fan-out steps:
 * - "artifact_truth": Step is done when artifact RPC confirms all items exist (e.g. all lessons real)
 * - "subjob_count":   Step is done when all spawned subjobs are completed
 * - "hybrid":         Both artifact truth AND zero active subjobs required (safest)
 */
export type FanOutCompletionMode = "artifact_truth" | "subjob_count" | "hybrid";

export interface FanOutStepConfig {
  /** The step_key this config applies to */
  stepKey: PipelineStepKey;
  /** Job type(s) spawned as subjobs for this step */
  subjobTypes: string[];
  /** How completion is determined */
  completionMode: FanOutCompletionMode;
  /** RPC name that returns { ok: boolean, total: number, done: number } for artifact truth */
  completionRpc?: string;
  /** Max concurrent subjobs per package for this step */
  wipPerPackage: number;
  /** Scheduling weight for subjob priority (higher = more critical) */
  subjobPriority: number;
  /** Whether the orchestrator root job should be re-enqueued to spawn more batches */
  useBatchCursor: boolean;
  /**
   * If true, failed subjobs do NOT block step completion.
   * The step will be marked "done" even if some subjobs failed,
   * because the step is a quality layer, not a completeness gate.
   * Default: false (failed subjobs block the step).
   */
  softFailOnSubjobError?: boolean;
}

/**
 * SSOT: Fan-out step configurations.
 * Every step that decomposes into subjobs MUST be registered here.
 * The runner, watchdog, and stuck-scan all consume this config.
 */
export const FAN_OUT_CONFIG: FanOutStepConfig[] = [
  {
    stepKey: "fanout_learning_content",
    subjobTypes: ["lesson_generate_content_shard"],
    completionMode: "subjob_count",
    wipPerPackage: 3,
    subjobPriority: 15,
    useBatchCursor: false,
  },
  {
    stepKey: "generate_learning_content",
    subjobTypes: ["lesson_generate_competency_bundle", "lesson_generate_content", "package_generate_learning_content"],
    completionMode: "hybrid",
    completionRpc: "get_learning_content_progress",
    wipPerPackage: 12,
    subjobPriority: 15,
    useBatchCursor: true,
  },
  {
    stepKey: "auto_seed_exam_blueprints",
    subjobTypes: ["package_auto_seed_exam_blueprints"],
    completionMode: "subjob_count",
    wipPerPackage: 8,
    subjobPriority: 10,
    useBatchCursor: false,
  },
  {
    stepKey: "generate_exam_pool",
    subjobTypes: ["package_generate_exam_pool"],
    completionMode: "hybrid",
    completionRpc: "get_exam_pool_progress",
    wipPerPackage: 8,
    subjobPriority: 10,
    useBatchCursor: true,
  },
  {
    stepKey: "generate_oral_exam",
    subjobTypes: ["package_generate_oral_exam"],
    completionMode: "subjob_count",
    wipPerPackage: 4,
    subjobPriority: 5,
    useBatchCursor: false,
  },
  {
    stepKey: "generate_lesson_minichecks",
    subjobTypes: ["package_generate_lesson_minichecks"],
    completionMode: "subjob_count",
    wipPerPackage: 6,
    subjobPriority: 5,
    useBatchCursor: true,
  },
  {
    stepKey: "generate_handbook",
    subjobTypes: ["package_generate_handbook"],
    completionMode: "subjob_count",
    wipPerPackage: 4,
    subjobPriority: 5,
    useBatchCursor: true,
  },
  {
    stepKey: "expand_handbook",
    subjobTypes: ["handbook_expand_section"],
    completionMode: "subjob_count",
    wipPerPackage: 4,
    subjobPriority: 3,
    useBatchCursor: false,
    // CRITICAL: Expand is a quality layer — failed sections must NOT block the step.
    // Sections track their own expand_status (failed_soft) for retry via enqueue_handbook_expand.
    softFailOnSubjobError: true,
  },
];

/** Lookup fan-out config by step key */
export function getFanOutConfig(stepKey: string): FanOutStepConfig | undefined {
  return FAN_OUT_CONFIG.find(c => c.stepKey === stepKey);
}

/** Set of all fan-out step keys (derived from SSOT) */
export const FAN_OUT_STEP_KEYS = new Set(FAN_OUT_CONFIG.map(c => c.stepKey));

/** All subjob types across all fan-out configs (for validation) */
export const ALL_SUBJOB_TYPES = new Set(FAN_OUT_CONFIG.flatMap(c => c.subjobTypes));

// ═══════════════════════════════════════════════════════════════
// Unified Job Definitions (SSOT for pool + edge function dispatch)
// ═══════════════════════════════════════════════════════════════

export type WorkerPool = "core" | "content" | "prebuild";

export interface JobDefinition {
  pool: WorkerPool;
  /** Edge function name to dispatch to. Only needed for content-runner dispatched jobs. */
  edgeFunction?: string;
}

/**
 * SSOT job definition table.
 * Pool routing AND edge function dispatch in ONE place — no drift possible.
 * Every job type that the runner can dispatch MUST have an edgeFunction here.
 */
export const JOB_DEFINITIONS: Record<string, JobDefinition> = {
  // ── content / heavy ─────────────────────────────────────────
  package_fanout_learning_content:   { pool: "core", edgeFunction: "fanout-learning-content" },
  package_generate_learning_content: { pool: "content", edgeFunction: "package-generate-learning-content" },
  lesson_generate_content_shard:     { pool: "content", edgeFunction: "lesson-generate-content-shard" },
  package_finalize_learning_content: { pool: "core", edgeFunction: "finalize-learning-content" },
  package_generate_handbook:         { pool: "content", edgeFunction: "package-generate-handbook" },
  package_generate_glossary:         { pool: "content", edgeFunction: "package-generate-glossary" },
  package_generate_oral_exam:        { pool: "content", edgeFunction: "package-generate-oral-exam" },
  package_generate_lesson_minichecks:{ pool: "content", edgeFunction: "package-generate-lesson-minichecks" },
  mass_enrich_competencies_v2:       { pool: "content", edgeFunction: "mass-enrich-competencies" },
  pool_fill_lf_gaps:                 { pool: "content", edgeFunction: "pool-fill-lf-gaps" },
  pool_fill_bloom_gaps:              { pool: "content", edgeFunction: "pool-fill-bloom-gaps" },
  package_exam_rebalance:            { pool: "core", edgeFunction: "package-exam-rebalance" },
  lesson_generate_content:           { pool: "content", edgeFunction: "lesson-generate-content" },
  lesson_generate_competency_bundle: { pool: "content", edgeFunction: "lesson-generate-competency-bundle" },
  package_generate_exam_pool:        { pool: "content", edgeFunction: "package-generate-exam-pool" },

  // ── core / orchestration + validation ───────────────────────
  pipeline_tick:                     { pool: "core" },
  stuck_scan:                        { pool: "core" },
  package_scaffold_learning_course:  { pool: "core", edgeFunction: "package-scaffold-learning-course" },
  package_validate_blueprints:       { pool: "core", edgeFunction: "package-validate-blueprints" },
  package_validate_exam_pool:        { pool: "core", edgeFunction: "package-validate-exam-pool" },
  package_repair_exam_pool_quality:  { pool: "core", edgeFunction: "package-repair-exam-pool-quality" },
  package_validate_learning_content: { pool: "core", edgeFunction: "package-validate-learning-content" },
  repair_learning_content:           { pool: "content", edgeFunction: "repair-learning-content" },
  regenerate_learning_content_cluster: { pool: "content", edgeFunction: "regenerate-learning-content-cluster" },
  package_validate_oral_exam:        { pool: "core", edgeFunction: "package-validate-oral-exam" },
  package_validate_tutor_index:      { pool: "core", edgeFunction: "package-validate-tutor-index" },
  package_validate_lesson_minichecks:{ pool: "core", edgeFunction: "package-validate-lesson-minichecks" },
  package_validate_handbook:         { pool: "core", edgeFunction: "package-validate-handbook" },
  package_enqueue_handbook_expand:   { pool: "core", edgeFunction: "package-enqueue-handbook-expand" },
  handbook_expand_section:           { pool: "content", edgeFunction: "expand-handbook-section" },
  package_validate_handbook_depth:   { pool: "core", edgeFunction: "package-validate-handbook-depth" },
  // ── prebuild / variant materialization (separate pool) ────────
  package_generate_blueprint_variants:  { pool: "prebuild", edgeFunction: "generate-blueprint-variants" },
  package_validate_blueprint_variants:  { pool: "prebuild", edgeFunction: "validate-blueprint-variants" },
  package_promote_blueprint_variants:   { pool: "prebuild", edgeFunction: "promote-blueprint-variants" },
  ensure_variant_inventory:             { pool: "prebuild", edgeFunction: "ensure-variant-inventory" },
  validate_variant_inventory:           { pool: "prebuild", edgeFunction: "validate-variant-inventory" },
  package_build_ai_tutor_index:      { pool: "core", edgeFunction: "package-build-ai-tutor-index" },
  package_elite_harden:              { pool: "core", edgeFunction: "package-elite-harden" },
  package_run_integrity_check:       { pool: "core", edgeFunction: "package-run-integrity-check" },
  package_quality_council:           { pool: "core", edgeFunction: "package-quality-council" },
  package_auto_publish:              { pool: "core", edgeFunction: "package-auto-publish" },

  // ── legacy / utility ────────────────────────────────────────
  extract_curriculum:                { pool: "core", edgeFunction: "extract-curriculum" },
  generate_curriculum_content:       { pool: "core", edgeFunction: "generate-curriculum-content" },
  setup_course_package:              { pool: "core", edgeFunction: "setup-course-package" },
  generate_course:                   { pool: "core", edgeFunction: "generate-course" },
  generate_course_batch:             { pool: "core", edgeFunction: "generate-course-batch" },
  seed_exam_questions:               { pool: "core", edgeFunction: "generate-blueprint-questions" },
  enrich_exam_solutions:             { pool: "core", edgeFunction: "blooms-taxonomy" },
  upgrade_minichecks_v1:             { pool: "core", edgeFunction: "regenerate-minichecks" },
  quality_gate_precheck:             { pool: "core", edgeFunction: "run-quality-checks" },
  curriculum_smoke:                  { pool: "core", edgeFunction: "run-quality-checks" },
  qc_worker_full:                    { pool: "core", edgeFunction: "qc-worker" },
  quality_gate_7:                    { pool: "core", edgeFunction: "quality-gate-check" },
  seo_foundation:                    { pool: "core", edgeFunction: "generate-seo-slug" },
  seo_audit:                         { pool: "core", edgeFunction: "ihk-quality-audit" },
  seo_internal_links:                { pool: "core", edgeFunction: "seo-internal-linker" },
  seo_sitemap_refresh:               { pool: "core", edgeFunction: "generate-sitemap" },
  seo_generate:                      { pool: "core", edgeFunction: "seo-generate" },
  seo_qc_check:                      { pool: "core", edgeFunction: "seo-qc-check" },
  seo_publish:                       { pool: "core", edgeFunction: "seo-publish" },
  seo_content_batch:                 { pool: "core", edgeFunction: "seo-generate" },
  publish_product:                   { pool: "core", edgeFunction: "product-orchestrator" },
  repair_lessons:                    { pool: "core", edgeFunction: "repair-lessons" },
  improve_lesson:                    { pool: "core", edgeFunction: "improve-lesson" },
  validate_content:                  { pool: "core", edgeFunction: "validate-content" },
  upgrade_ihk:                       { pool: "core", edgeFunction: "course-upgrade-ihk" },
  auto_gap_close:                    { pool: "core", edgeFunction: "auto-gap-close" },
  generate_image:                    { pool: "core", edgeFunction: "generate-image" },
  daily_test_run:                    { pool: "core", edgeFunction: "daily-test-runner" },
  generate_questions:                { pool: "core", edgeFunction: "generate-questions" },
  auto_map_topics_to_blueprint:      { pool: "core", edgeFunction: "auto-map-topics-to-blueprint" },
  blooms_classify:                   { pool: "core", edgeFunction: "blooms-taxonomy" },
  package_curriculum_ingest:         { pool: "core", edgeFunction: "package-curriculum-ingest" },
  ingest_curriculum_document:        { pool: "core", edgeFunction: "ingest-curriculum-document" },
  generate_handbook:                 { pool: "core", edgeFunction: "package-generate-handbook" },
  heal_poison_lessons:               { pool: "core", edgeFunction: "heal-poison-lessons" },
  rework_trap_retrofit:              { pool: "core", edgeFunction: "pool-rework-trap-retrofit" },
  package_queue_next:                { pool: "core", edgeFunction: "package-queue-next" },

  // ── assessment council ──────────────────────────────────────
  assessment_blueprint_propose:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_blueprint_critique:     { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_blueprint_verdict:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_blueprint_approve:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_questions_generate:     { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_questions_critique:     { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_questions_verdict:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_questions_approve:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_minicheck_assemble:     { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_minicheck_critique:     { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_minicheck_verdict:      { pool: "core", edgeFunction: "assessment-council-run" },
  assessment_minicheck_approve:      { pool: "core", edgeFunction: "assessment-council-run" },
  course_finalize:                   { pool: "core", edgeFunction: "course-finalizer" },
  post_validation:                   { pool: "core", edgeFunction: "post-validation" },

  // ── council generic ─────────────────────────────────────────
  council_run_step:                  { pool: "core", edgeFunction: "council-run-step" },
  council_propose_step:              { pool: "core", edgeFunction: "council-run-step" },
  council_critique_step:             { pool: "core", edgeFunction: "council-run-step" },
  council_revise_step:               { pool: "core", edgeFunction: "council-run-step" },
  council_vote_and_verdict:          { pool: "core", edgeFunction: "council-run-step" },
  council_publish_step:              { pool: "core", edgeFunction: "council-run-step" },
  council_recompute_course_ready:    { pool: "core", edgeFunction: "council-run-step" },

  // ── tech council ────────────────────────────────────────────
  tech_scan_rls:                     { pool: "core", edgeFunction: "tech-council-run" },
  tech_scan_edge:                    { pool: "core", edgeFunction: "tech-council-run" },
  tech_scan_queue:                   { pool: "core", edgeFunction: "tech-council-run" },
  tech_propose_patch:                { pool: "core", edgeFunction: "tech-council-run" },
  tech_validate_patch:               { pool: "core", edgeFunction: "tech-council-run" },
  tech_full_pipeline:                { pool: "core", edgeFunction: "tech-council-run" },

  // ── marketing council ───────────────────────────────────────
  marketing_seed_assets:             { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_propose:                 { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_critique:                { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_revise:                  { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_verdict:                 { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_publish:                 { pool: "core", edgeFunction: "marketing-council-run" },
  marketing_full_pipeline:           { pool: "core", edgeFunction: "marketing-council-run" },

  // ── tutor council ───────────────────────────────────────────
  tutor_seed_assets:                 { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_council_run_asset:           { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_backfill_assets_for_course:  { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_validate_runtime_templates:  { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_oral_exam_propose:           { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_oral_exam_critique:          { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_oral_exam_verdict:           { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_feedback_propose:            { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_feedback_critique:           { pool: "core", edgeFunction: "tutor-council-run" },
  tutor_feedback_verdict:            { pool: "core", edgeFunction: "tutor-council-run" },

  // ── compliance council ──────────────────────────────────────
  compliance_scan:                   { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_scan_pii:               { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_scan_rls:               { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_scan_retention:         { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_scan_ai_act:            { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_scan_azav:              { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_recompute_block:        { pool: "core", edgeFunction: "compliance-council-scan" },
  compliance_remediate:              { pool: "core", edgeFunction: "compliance-council-remediate" },
  compliance_report:                 { pool: "core", edgeFunction: "compliance-council-report" },
  compliance_export_pdf:             { pool: "core", edgeFunction: "compliance-council-export-pdf" },

  // ── other councils ──────────────────────────────────────────
  growth_run:                        { pool: "core", edgeFunction: "growth-council-run" },
  growth_actions_api:                { pool: "core", edgeFunction: "growth-actions-api" },
  finance_reconcile:                 { pool: "core", edgeFunction: "finance-council-reconcile" },
  finance_export_csv:                { pool: "core", edgeFunction: "finance-export-csv" },
  finance_export_datev:              { pool: "core", edgeFunction: "finance-export-datev" },
  qa_smoke:                          { pool: "core", edgeFunction: "qa-council-smoke" },
  qa_runtime_smoke:                  { pool: "core", edgeFunction: "qa-council-runtime-smoke" },
  qa_h5p_smoke:                      { pool: "core", edgeFunction: "qa-council-h5p-smoke" },
  qa_error_budget:                   { pool: "core", edgeFunction: "qa-council-error-budget" },

  // ── security ────────────────────────────────────────────────
  claim_license_secure:              { pool: "core", edgeFunction: "claim-license-secure" },
  security_gate_check:               { pool: "core", edgeFunction: "security-gate-check" },
  security_botnet_gate:              { pool: "core", edgeFunction: "security-botnet-gate" },

  // ── blueprint seeding ───────────────────────────────────────
  blueprint_generate_variants:       { pool: "content", edgeFunction: "blueprint-seed-by-competency" },

  // ── seeding / orchestration ─────────────────────────────────
  seo_certification_generate:        { pool: "core", edgeFunction: "seo-certification-generate" },
  batch_curriculum_pipeline:         { pool: "core", edgeFunction: "batch-curriculum-pipeline" },

  // ── store / billing ─────────────────────────────────────────
  expire_store_subscriptions:        { pool: "core" },
  process_lti_grade_passback:        { pool: "core" },
  reconcile_store_purchases:         { pool: "core", edgeFunction: "reconcile-store-purchases" },
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

/** All known job types (SSOT). Used for runtime validation at enqueue time. */
export const KNOWN_JOB_TYPES = new Set(Object.keys(JOB_DEFINITIONS));

/** Runtime guard: throws if jobType is not registered in JOB_DEFINITIONS. */
export function assertKnownJobType(jobType: string): void {
  if (!KNOWN_JOB_TYPES.has(jobType)) {
    throw new Error(`UNKNOWN_JOB_TYPE: "${jobType}" not in JOB_DEFINITIONS. Register it in _shared/job-map.ts first.`);
  }
}

/** Backoff heuristic for stale/failed job requeues */
export function inferBackoffSeconds(reason: string | number): number {
  if (typeof reason === "number") {
    // Called with attempt count — exponential backoff
    return Math.min(300, 30 * Math.pow(1.5, reason));
  }
  const r = (reason || "").toLowerCase();
  if (!r) return 30;
  if (r.includes("rate limit") || r.includes("429")) return 45;
  if (r.includes("timeout") || r.includes("504") || r.includes("deadline")) return 90;
  if (r.includes("unknown") || r.includes("edge") || r.includes("worker job failed")) return 60;
  // Job-type aware: heavy generators get longer cooldown
  if (r.includes("elite_harden") || r.includes("generate_exam") || r.includes("generate_learning")) return 60;
  if (r.includes("generate_") || r.includes("scaffold_")) return 45;
  return 30;
}

// ═══════════════════════════════════════════════════════════════
// Pipeline DAG — Explicit dependency graph for static validation
// ═══════════════════════════════════════════════════════════════

export interface PipelineNode {
  key: PipelineStepKey;
  dependsOn?: PipelineStepKey[];
  /** Artifacts this step produces when completed successfully */
  produces?: string[];
  /** Artifacts this step requires before it can run */
  requires?: string[];
  /** Scheduling weight: higher = more expensive. Used for predictive scheduling. */
  weight?: number;
  /** Downstream impact: how many steps are transitively unblocked by this step's artifact.
   *  Computed by computeArtifactImpact(). Used by Phase 6 predictive scheduling. */
  artifactImpact?: number;
}

/**
 * SSOT: Explicit pipeline DAG.
 * Used by CI guards + runner boot-time validation.
 * Adding a step? Add it here with correct dependencies.
 */
export const PIPELINE_GRAPH: PipelineNode[] = [
  { key: "scaffold_learning_course", produces: ["course_scaffold"], weight: 2 },
  { key: "generate_glossary", dependsOn: ["scaffold_learning_course"], requires: ["course_scaffold"], produces: ["glossary"], weight: 3 },
  { key: "fanout_learning_content", dependsOn: ["scaffold_learning_course"], requires: ["course_scaffold"], produces: ["content_shards"], weight: 2 },
  { key: "generate_learning_content", dependsOn: ["fanout_learning_content"], requires: ["content_shards"], produces: ["learning_content"], weight: 10 },
  { key: "finalize_learning_content", dependsOn: ["generate_learning_content"], requires: ["learning_content"], produces: ["finalized_learning_content"], weight: 2 },
  { key: "validate_learning_content", dependsOn: ["finalize_learning_content"], requires: ["finalized_learning_content"], produces: ["validated_learning_content"], weight: 3 },
  { key: "auto_seed_exam_blueprints", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["exam_blueprints"], weight: 6 },
  { key: "validate_blueprints", dependsOn: ["auto_seed_exam_blueprints"], requires: ["exam_blueprints"], produces: ["validated_blueprints"], weight: 2 },
  { key: "generate_blueprint_variants", dependsOn: ["validate_blueprints"], requires: ["validated_blueprints"], produces: ["blueprint_variants"], weight: 6 },
  { key: "validate_blueprint_variants", dependsOn: ["generate_blueprint_variants"], requires: ["blueprint_variants"], produces: ["validated_blueprint_variants"], weight: 2 },
  { key: "promote_blueprint_variants", dependsOn: ["validate_blueprint_variants"], requires: ["validated_blueprint_variants"], produces: ["promoted_variants"], weight: 3 },
  { key: "generate_exam_pool", dependsOn: ["promote_blueprint_variants"], requires: ["promoted_variants"], produces: ["exam_questions"], weight: 8 },
  { key: "validate_exam_pool", dependsOn: ["generate_exam_pool"], requires: ["exam_questions"], produces: ["validated_exam_pool"], weight: 3 },
  { key: "repair_exam_pool_quality", dependsOn: ["generate_exam_pool"], requires: ["exam_questions"], produces: ["repaired_exam_pool"], weight: 4 },
  { key: "build_ai_tutor_index", dependsOn: ["validate_exam_pool"], requires: ["validated_exam_pool"], produces: ["tutor_index"], weight: 4 },
  { key: "validate_tutor_index", dependsOn: ["build_ai_tutor_index"], requires: ["tutor_index"], produces: ["validated_tutor_index"], weight: 2 },
  { key: "generate_oral_exam", dependsOn: ["validate_tutor_index"], requires: ["validated_tutor_index"], produces: ["oral_exam"], weight: 5 },
  { key: "validate_oral_exam", dependsOn: ["generate_oral_exam"], requires: ["oral_exam"], produces: ["validated_oral_exam"], weight: 2 },
  { key: "generate_lesson_minichecks", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["lesson_minichecks"], weight: 5 },
  { key: "validate_lesson_minichecks", dependsOn: ["generate_lesson_minichecks"], requires: ["lesson_minichecks"], produces: ["validated_minichecks"], weight: 2 },
  { key: "generate_handbook", dependsOn: ["validate_learning_content"], requires: ["validated_learning_content"], produces: ["handbook_basis"], weight: 7 },
  { key: "validate_handbook", dependsOn: ["generate_handbook"], requires: ["handbook_basis"], produces: ["validated_handbook"], weight: 2 },
  { key: "enqueue_handbook_expand", dependsOn: ["validate_handbook"], requires: ["validated_handbook"], produces: ["handbook_expand_queued"], weight: 1 },
  { key: "expand_handbook", dependsOn: ["enqueue_handbook_expand"], requires: ["handbook_expand_queued"], produces: ["handbook_expanded"], weight: 5 },
  { key: "validate_handbook_depth", dependsOn: ["expand_handbook"], requires: ["handbook_expanded"], produces: ["validated_handbook_depth"], weight: 2 },
  { key: "elite_harden", dependsOn: ["validate_exam_pool"], requires: ["validated_exam_pool"], produces: ["elite_ready"], weight: 6 },
  { key: "run_integrity_check", dependsOn: ["elite_harden", "validate_lesson_minichecks", "validate_handbook_depth", "validate_oral_exam", "validate_tutor_index"], requires: ["elite_ready", "validated_minichecks", "validated_handbook_depth", "validated_oral_exam", "validated_tutor_index"], produces: ["integrity_passed"], weight: 3 },
  { key: "quality_council", dependsOn: ["run_integrity_check"], requires: ["integrity_passed"], produces: ["council_approved"], weight: 4 },
  { key: "auto_publish", dependsOn: ["quality_council"], requires: ["council_approved"], produces: ["published"], weight: 1 },
];

/**
 * Compute artifact impact score: how many downstream steps are transitively
 * unblocked when this step completes. Higher = more critical to schedule first.
 * This powers Phase 6 — Predictive Scheduling.
 */
export function computeArtifactImpact(graph: PipelineNode[]): Map<string, number> {
  const impactMap = new Map<string, number>();

  // Build artifact → consumers mapping
  const artifactConsumers = new Map<string, Set<string>>();
  for (const node of graph) {
    for (const req of node.requires ?? []) {
      if (!artifactConsumers.has(req)) artifactConsumers.set(req, new Set());
      artifactConsumers.get(req)!.add(node.key);
    }
  }

  // For each node, count how many downstream steps are transitively dependent
  function countDownstream(key: string, visited: Set<string>): number {
    if (visited.has(key)) return 0;
    visited.add(key);
    const node = graph.find(n => n.key === key);
    if (!node?.produces) return 0;

    let count = 0;
    for (const artifact of node.produces) {
      const consumers = artifactConsumers.get(artifact);
      if (!consumers) continue;
      for (const consumerKey of consumers) {
        count += 1 + countDownstream(consumerKey, visited);
      }
    }
    return count;
  }

  for (const node of graph) {
    const downstream = countDownstream(node.key, new Set());
    impactMap.set(node.key, downstream);
    node.artifactImpact = downstream;
  }

  return impactMap;
}

// Compute impact scores at module load time (available for scheduling)
export const ARTIFACT_IMPACT = computeArtifactImpact(PIPELINE_GRAPH);

/**
 * Returns a scheduling priority bump for a job based on its artifact impact.
 * Higher impact producers get priority 5-15, validators/terminals get 0.
 * Used by Phase 6 predictive scheduling.
 */
export function getArtifactPriorityBump(stepKey: string): number {
  const impact = ARTIFACT_IMPACT.get(stepKey) ?? 0;
  if (impact >= 10) return 15; // critical producers (scaffold, generate_learning_content)
  if (impact >= 5) return 10;  // major producers (exam_pool, blueprints)
  if (impact >= 2) return 5;   // medium producers
  return 0;                     // terminals/validators
}

/**
 * Validates the pipeline DAG at boot/CI time.
 * Throws on: missing dependencies, cycles, unreachable nodes, orphaned validate_* steps.
 */
export function validatePipelineGraph(graph: PipelineNode[]): void {
  const keys = new Set(graph.map(n => n.key));
  const keyList = [...keys];

  // 1. Every dependency must exist in the graph
  for (const node of graph) {
    for (const dep of node.dependsOn ?? []) {
      if (!keys.has(dep)) {
        throw new Error(`PIPELINE_DAG_INVALID: "${node.key}" depends on missing step "${dep}"`);
      }
    }
  }

  // 2. Cycle detection (DFS)
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(nodeKey: string) {
    if (stack.has(nodeKey)) {
      throw new Error(`PIPELINE_DAG_CYCLE: cycle detected at "${nodeKey}"`);
    }
    if (visited.has(nodeKey)) return;
    visited.add(nodeKey);
    stack.add(nodeKey);
    const node = graph.find(n => n.key === nodeKey);
    for (const dep of node?.dependsOn ?? []) {
      dfs(dep);
    }
    stack.delete(nodeKey);
  }

  for (const k of keyList) dfs(k);

  // 3. Every FULL_STEP_ORDER key must be in DAG and vice versa
  for (const step of FULL_STEP_ORDER) {
    if (!keys.has(step)) {
      throw new Error(`PIPELINE_DAG_MISSING: FULL_STEP_ORDER contains "${step}" but DAG does not`);
    }
  }
  for (const k of keyList) {
    if (!FULL_STEP_ORDER.includes(k)) {
      throw new Error(`PIPELINE_DAG_ORPHAN: DAG contains "${k}" but FULL_STEP_ORDER does not`);
    }
  }

  // 4. validate_* must have a dependency (no standalone validators)
  for (const node of graph) {
    if (node.key.startsWith("validate_") && (!node.dependsOn || node.dependsOn.length === 0)) {
      throw new Error(`PIPELINE_DAG_INVALID: validator "${node.key}" has no dependencies`);
    }
  }

  // 5. Artifact integrity: every required artifact must have a producer
  const allProduced = new Set<string>();
  for (const node of graph) {
    for (const a of node.produces ?? []) allProduced.add(a);
  }
  for (const node of graph) {
    for (const a of node.requires ?? []) {
      if (!allProduced.has(a)) {
        throw new Error(`PIPELINE_DAG_ARTIFACT: "${node.key}" requires artifact "${a}" but no step produces it`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Artifact Resolver — checks if a step's required artifacts exist
// ═══════════════════════════════════════════════════════════════

/** Find the pipeline node that produces a given artifact */
export function findProducer(artifact: string): PipelineNode | undefined {
  return PIPELINE_GRAPH.find(n => n.produces?.includes(artifact));
}

/** Find the pipeline node for a given step key */
export function findNode(stepKey: string): PipelineNode | undefined {
  return PIPELINE_GRAPH.find(n => n.key === stepKey);
}
