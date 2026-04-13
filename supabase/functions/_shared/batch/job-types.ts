/**
 * batch/job-types.ts — SSOT for batch job_type constants.
 *
 * Every batch enqueue, importer registry, routing flag, and policy
 * MUST reference these constants. No string literals allowed.
 */

export const BATCH_JOB_TYPES = {
  LESSON_GENERATE_CONTENT: "lesson_generate_content",
  PACKAGE_GENERATE_EXAM_POOL: "package_generate_exam_pool",
  EXPAND_HANDBOOK_SECTION: "handbook_expand_section",  // P4 FIX: canonical name
  PACKAGE_GENERATE_HANDBOOK: "package_generate_handbook",
  PACKAGE_GENERATE_ORAL_EXAM: "package_generate_oral_exam",
  PACKAGE_GENERATE_LESSON_MINICHECKS: "package_generate_lesson_minichecks",
  PACKAGE_GENERATE_GLOSSARY: "package_generate_glossary",
  BLUEPRINT_ENRICH: "blueprint_enrich",
} as const;

export type BatchJobType = (typeof BATCH_JOB_TYPES)[keyof typeof BATCH_JOB_TYPES];
