/**
 * Step Policy — SSOT for track-aware step inclusion/skipping.
 *
 * Uses ContentProfile to determine which pipeline steps are required
 * for a given track. Steps not required are marked "skipped" at scaffold time.
 *
 * Step keys mirror the canonical FULL_STEP_ORDER from _shared/job-map.ts.
 */

import { getContentProfile } from "../contentProfiles";
import { normalizeTrack } from "../tracks";

/**
 * Canonical step order — must match FULL_STEP_ORDER in job-map.ts exactly.
 * Client-side mirror for UI, progress display, and scaffold logic.
 */
export const FULL_STEP_ORDER = [
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
] as const;

export type StepKey = (typeof FULL_STEP_ORDER)[number];

/**
 * Determines if a pipeline step is required for a given track.
 * Uses ContentProfile as the single source for inclusion logic.
 */
export function isStepRequiredForTrack(stepKey: StepKey, trackInput: unknown): boolean {
  const profile = getContentProfile(trackInput);

  switch (stepKey) {
    // ── Learning Course Chain ─────────────────────────
    case "scaffold_learning_course":
    case "generate_glossary":
    case "fanout_learning_content":
    case "generate_learning_content":
    case "finalize_learning_content":
    case "validate_learning_content":
      return profile.includeLearningCourse;

    // ── MiniChecks ────────────────────────────────────
    case "generate_lesson_minichecks":
    case "validate_lesson_minichecks":
      return profile.includeMiniChecks;

    // ── Handbook ──────────────────────────────────────
    case "generate_handbook":
    case "validate_handbook":
      return profile.includeHandbook;

    case "enqueue_handbook_expand":
    case "expand_handbook":
    case "validate_handbook_depth":
      return profile.includeHandbookExpand;

    // ── Exam Pipeline ────────────────────────────────
    case "auto_seed_exam_blueprints":
    case "validate_blueprints":
    case "generate_blueprint_variants":
    case "validate_blueprint_variants":
    case "promote_blueprint_variants":
    case "generate_exam_pool":
    case "validate_exam_pool":
    case "repair_exam_pool_quality":
      return profile.includeExamPool;

    // ── Oral Exam ────────────────────────────────────
    case "generate_oral_exam":
    case "validate_oral_exam":
      return profile.includeOralExam;

    // ── AI Tutor Index ───────────────────────────────
    case "build_ai_tutor_index":
    case "validate_tutor_index":
      return profile.includeTutorIndex;

    // ── Terminal Steps (always required) ──────────────
    case "elite_harden":
    case "run_integrity_check":
    case "quality_council":
    case "auto_publish":
      return true;

    default:
      return true;
  }
}

/**
 * Returns only the steps required for a given track, in canonical order.
 */
export function getRequiredStepsForTrack(trackInput: unknown): StepKey[] {
  return FULL_STEP_ORDER.filter((step) => isStepRequiredForTrack(step, trackInput));
}

/**
 * Returns the steps that should be skipped for a given track.
 */
export function getSkippedStepsForTrack(trackInput: unknown): StepKey[] {
  const required = new Set(getRequiredStepsForTrack(trackInput));
  return FULL_STEP_ORDER.filter((step) => !required.has(step));
}
