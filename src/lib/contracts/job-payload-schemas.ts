import { z } from "zod";

/**
 * SSOT Job Payload Schemas — Typed Contracts per Job Type
 *
 * Jeder Job-Typ hat ein verbindliches Payload-Schema.
 * Alle Keys sind ausschließlich snake_case (siehe payload-key-contract-guard).
 *
 * Ref: Incident April 2026 — Key-Drift verursachte Re-Entry-Loops.
 *
 * RULE: Neue Job-Typen MÜSSEN hier registriert werden.
 * RULE: Der CI-Guard prüft, dass keine camelCase-Keys emittiert werden.
 */

const uuid = z.string().uuid();
const optUuid = z.string().uuid().optional();
const nullOptUuid = z.string().uuid().nullable().optional();
const optStr = z.string().min(1).optional();

// ─── Shared Base Schemas ─────────────────────────────────────────────

/** Minimal identity every package-scoped job MUST carry */
export const PackageJobBaseSchema = z.object({
  package_id: uuid,
  curriculum_id: optUuid,
  course_id: nullOptUuid,
});

/** Extended base with step context */
export const StepJobBaseSchema = PackageJobBaseSchema.extend({
  step_key: optStr,
});

// ─── System / Infrastructure Jobs ────────────────────────────────────

export const PipelineTickPayloadSchema = z.object({
  trigger: z.enum(["cron", "manual", "deploy"]).optional(),
});

export const StuckScanPayloadSchema = z.object({
  threshold_minutes: z.number().int().positive().optional(),
});

// ─── Curriculum & Course Setup ───────────────────────────────────────

export const SetupCoursePackagePayloadSchema = PackageJobBaseSchema.extend({
  track: optStr,
  program_type: optStr,
});

export const GenerateCurriculumContentPayloadSchema = PackageJobBaseSchema.extend({
  learning_field_filter: optStr,
});

export const ScaffoldLearningCoursePayloadSchema = PackageJobBaseSchema;

// ─── Learning Content Pipeline ───────────────────────────────────────

export const FanoutLearningContentPayloadSchema = PackageJobBaseSchema;

export const GenerateLearningContentPayloadSchema = PackageJobBaseSchema.extend({
  learning_field_filter: optStr,
});

export const LessonGenerateContentPayloadSchema = PackageJobBaseSchema.extend({
  lesson_id: optUuid,
  competency_id: optUuid,
});

export const LessonGenerateContentShardPayloadSchema = PackageJobBaseSchema.extend({
  lesson_id: uuid,
  shard_index: z.number().int().min(0).optional(),
});

export const LessonGenerateCompetencyBundlePayloadSchema = PackageJobBaseSchema.extend({
  competency_id: uuid,
});

export const FinalizeLearningContentPayloadSchema = PackageJobBaseSchema;

export const ValidateLearningContentPayloadSchema = PackageJobBaseSchema;

// ─── Lesson Minichecks ───────────────────────────────────────────────

export const GenerateLessonMinichecksPayloadSchema = PackageJobBaseSchema;

export const ValidateLessonMinichecksPayloadSchema = PackageJobBaseSchema;

// ─── Handbook Pipeline ───────────────────────────────────────────────

export const GenerateHandbookPayloadSchema = PackageJobBaseSchema;

export const ValidateHandbookPayloadSchema = PackageJobBaseSchema;

export const ValidateHandbookDepthPayloadSchema = PackageJobBaseSchema;

export const EnqueueHandbookExpandPayloadSchema = PackageJobBaseSchema;

export const HandbookExpandSectionPayloadSchema = PackageJobBaseSchema.extend({
  section_id: optUuid,
  section_title: optStr,
});

// ─── Glossary ────────────────────────────────────────────────────────

export const GenerateGlossaryPayloadSchema = PackageJobBaseSchema;

// ─── Exam Blueprint Pipeline ─────────────────────────────────────────

export const AutoSeedExamBlueprintsPayloadSchema = PackageJobBaseSchema;

export const ValidateBlueprintsPayloadSchema = PackageJobBaseSchema;

// ─── Blueprint Variant Pipeline (prebuild pool) ──────────────────────

export const GenerateBlueprintVariantsPayloadSchema = PackageJobBaseSchema.extend({
  blueprint_id: optUuid,
  target_count: z.number().int().positive().optional(),
});

export const ValidateBlueprintVariantsPayloadSchema = PackageJobBaseSchema;

export const PromoteBlueprintVariantsPayloadSchema = PackageJobBaseSchema;

export const EnsureVariantInventoryPayloadSchema = PackageJobBaseSchema;

export const ValidateVariantInventoryPayloadSchema = PackageJobBaseSchema;

// ─── Exam Pool Pipeline ──────────────────────────────────────────────

export const GenerateExamPoolPayloadSchema = PackageJobBaseSchema;

export const ValidateExamPoolPayloadSchema = PackageJobBaseSchema;

// ─── Repair Jobs ─────────────────────────────────────────────────────

export const RepairExamPoolQualityPayloadSchema = PackageJobBaseSchema.extend({
  reason_codes: z.array(z.string()).optional(),
});

export const RepairMinichecksPayloadSchema = PackageJobBaseSchema;

export const ExamRebalancePayloadSchema = PackageJobBaseSchema.extend({
  rebalance_mode: z.enum(["bloom_gaps", "lf_gaps", "trap_gaps", "full"]).optional(),
});

export const PoolFillBloomGapsPayloadSchema = PackageJobBaseSchema;
export const PoolFillLfGapsPayloadSchema = PackageJobBaseSchema;
export const PoolFillTrapGapsPayloadSchema = PackageJobBaseSchema;
export const ReworkTrapRetrofitPayloadSchema = PackageJobBaseSchema;

// ─── Oral Exam ───────────────────────────────────────────────────────

export const GenerateOralExamPayloadSchema = PackageJobBaseSchema;

export const ValidateOralExamPayloadSchema = PackageJobBaseSchema;

// ─── AI Tutor Index ──────────────────────────────────────────────────

export const BuildAiTutorIndexPayloadSchema = PackageJobBaseSchema;

export const ValidateTutorIndexPayloadSchema = PackageJobBaseSchema;

// ─── Quality & Integrity ─────────────────────────────────────────────

export const RunIntegrityCheckPayloadSchema = PackageJobBaseSchema;

export const QualityCouncilPayloadSchema = PackageJobBaseSchema;

export const EliteHardenPayloadSchema = PackageJobBaseSchema;

// ─── Publishing ──────────────────────────────────────────────────────

export const AutoPublishPayloadSchema = PackageJobBaseSchema;

// ─── Registry: job_type → Schema ─────────────────────────────────────

/**
 * Canonical mapping from job_type string to its Zod payload schema.
 * Used by guards, validators, and the CI contract report.
 */
export const JOB_PAYLOAD_SCHEMA_REGISTRY: Record<string, z.ZodTypeAny> = {
  // System
  pipeline_tick: PipelineTickPayloadSchema,
  stuck_scan: StuckScanPayloadSchema,

  // Setup
  setup_course_package: SetupCoursePackagePayloadSchema,
  generate_curriculum_content: GenerateCurriculumContentPayloadSchema,
  package_scaffold_learning_course: ScaffoldLearningCoursePayloadSchema,

  // Learning Content
  package_fanout_learning_content: FanoutLearningContentPayloadSchema,
  package_generate_learning_content: GenerateLearningContentPayloadSchema,
  lesson_generate_content: LessonGenerateContentPayloadSchema,
  lesson_generate_content_shard: LessonGenerateContentShardPayloadSchema,
  lesson_generate_competency_bundle: LessonGenerateCompetencyBundlePayloadSchema,
  package_finalize_learning_content: FinalizeLearningContentPayloadSchema,
  package_validate_learning_content: ValidateLearningContentPayloadSchema,

  // Minichecks
  package_generate_lesson_minichecks: GenerateLessonMinichecksPayloadSchema,
  package_validate_lesson_minichecks: ValidateLessonMinichecksPayloadSchema,

  // Handbook
  package_generate_handbook: GenerateHandbookPayloadSchema,
  package_validate_handbook: ValidateHandbookPayloadSchema,
  package_validate_handbook_depth: ValidateHandbookDepthPayloadSchema,
  package_enqueue_handbook_expand: EnqueueHandbookExpandPayloadSchema,
  handbook_expand_section: HandbookExpandSectionPayloadSchema,

  // Glossary
  package_generate_glossary: GenerateGlossaryPayloadSchema,

  // Exam Blueprints
  package_auto_seed_exam_blueprints: AutoSeedExamBlueprintsPayloadSchema,
  package_validate_blueprints: ValidateBlueprintsPayloadSchema,

  // Blueprint Variants (prebuild)
  package_generate_blueprint_variants: GenerateBlueprintVariantsPayloadSchema,
  blueprint_generate_variants: GenerateBlueprintVariantsPayloadSchema,
  package_validate_blueprint_variants: ValidateBlueprintVariantsPayloadSchema,
  package_promote_blueprint_variants: PromoteBlueprintVariantsPayloadSchema,
  ensure_variant_inventory: EnsureVariantInventoryPayloadSchema,
  validate_variant_inventory: ValidateVariantInventoryPayloadSchema,

  // Exam Pool
  package_generate_exam_pool: GenerateExamPoolPayloadSchema,
  package_validate_exam_pool: ValidateExamPoolPayloadSchema,

  // Repair
  package_repair_exam_pool_quality: RepairExamPoolQualityPayloadSchema,
  package_repair_minichecks: RepairMinichecksPayloadSchema,
  package_exam_rebalance: ExamRebalancePayloadSchema,
  pool_fill_bloom_gaps: PoolFillBloomGapsPayloadSchema,
  pool_fill_lf_gaps: PoolFillLfGapsPayloadSchema,
  pool_fill_trap_gaps: PoolFillTrapGapsPayloadSchema,
  rework_trap_retrofit: ReworkTrapRetrofitPayloadSchema,

  // Oral Exam
  package_generate_oral_exam: GenerateOralExamPayloadSchema,
  package_validate_oral_exam: ValidateOralExamPayloadSchema,

  // AI Tutor
  package_build_ai_tutor_index: BuildAiTutorIndexPayloadSchema,
  package_validate_tutor_index: ValidateTutorIndexPayloadSchema,

  // Quality & Integrity
  package_run_integrity_check: RunIntegrityCheckPayloadSchema,
  package_quality_council: QualityCouncilPayloadSchema,
  package_elite_harden: EliteHardenPayloadSchema,

  // Publishing
  package_auto_publish: AutoPublishPayloadSchema,
};

/**
 * Validate a job payload against the registered schema.
 * Returns { success: true, data } or { success: false, error }.
 */
export function validateJobPayload(jobType: string, payload: unknown) {
  const schema = JOB_PAYLOAD_SCHEMA_REGISTRY[jobType];
  if (!schema) {
    return { success: false as const, error: `Unknown job_type: ${jobType}` };
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { success: false as const, error: result.error.flatten().fieldErrors };
  }
  return { success: true as const, data: result.data };
}

/**
 * Get allowed payload keys for a job type.
 * Used by the CI contract report generator.
 */
export function getAllowedPayloadKeys(jobType: string): string[] | null {
  const schema = JOB_PAYLOAD_SCHEMA_REGISTRY[jobType];
  if (!schema || !(schema instanceof z.ZodObject)) return null;
  return Object.keys(schema.shape);
}
