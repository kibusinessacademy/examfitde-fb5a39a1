/**
 * SSOT: Canonical job type registry for client-side code.
 * Must stay in sync with ops_job_type_registry (DB) and _shared/job-map.ts (Edge).
 * CI guard: scripts/guards/guard-job-registry-parity.mjs
 */

export const KNOWN_JOB_TYPES = new Set([
  // ── Pipeline steps ──
  'extract_curriculum',
  'generate_course',
  'seed_exam_questions',
  'enrich_exam_solutions',
  'upgrade_minichecks_v1',
  'qc_worker_full',
  'course_finalize',
  'post_validation',
  'curriculum_smoke',
  'quality_gate_precheck',
  'publish_product',
  'package_repair_exam_pool_quality',
  // ── SEO ──
  'seo_foundation',
  'seo_audit',
  'seo_internal_links',
  'seo_generate',
  'seo_qc_check',
  'seo_sitemap_refresh',
  // ── IHK Upgrade ──
  'upgrade_ihk',
  // ── Council ──
  'council_propose_step',
  'council_critique_step',
  'council_vote_and_verdict',
  'council_publish_step',
  'council_recompute_course_ready',
  'council_run_step',
  // ── Seeding ──
  'seed_learning_fields',
  'seed_competencies',
  'seed_recheck',
  // ── LTI ──
  'process_lti_grade_passback',
] as const);

export type KnownJobType = typeof KNOWN_JOB_TYPES extends Set<infer T> ? T : string;

/**
 * Validates that a job type is registered. Throws before DB insert
 * so the error is caught early with a clear message.
 */
export function assertKnownJobType(jobType: string): asserts jobType is KnownJobType {
  if (!KNOWN_JOB_TYPES.has(jobType as KnownJobType)) {
    throw new Error(
      `UNKNOWN_JOB_TYPE: "${jobType}" is not registered in job-registry.ts. ` +
      `Register it in src/lib/jobs/job-registry.ts, ops_job_type_registry (DB), and _shared/job-map.ts.`
    );
  }
}
