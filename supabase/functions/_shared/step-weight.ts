/**
 * SSOT: Step-Weight Classification for Capacity-Aware Scheduling
 *
 * Every pipeline step is classified into a weight class.
 * The pipeline-runner uses these classes to enforce per-class
 * concurrency limits, preventing heavy LLM steps from starving
 * lighter orchestration/validation steps.
 *
 * Weight classes:
 *   heavy      — Full LLM generation (lessons, exams, oral). Max GPU/token pressure.
 *   medium     — Scaffolding, glossary, blueprints. Moderate LLM or DB-heavy.
 *   validation — All validate_* steps + quality gates. Separate pool to avoid blocking content.
 *   light      — Publish, integrity checks, tutor index. Minimal LLM pressure.
 */

import type { PipelineStepKey } from "./job-map.ts";

export type StepWeightClass = "heavy" | "medium" | "validation" | "light";

const STEP_WEIGHT_MAP: Record<PipelineStepKey, StepWeightClass> = {
  // ── Heavy: full LLM generation ──
  generate_learning_content:    "heavy",
  generate_exam_pool:           "heavy",
  generate_oral_exam:           "heavy",
  generate_lesson_minichecks:   "heavy",
  elite_harden:                 "heavy",

  // ── Medium: moderate LLM or orchestration ──
  scaffold_learning_course:     "medium",
  generate_glossary:            "medium",
  auto_seed_exam_blueprints:    "medium",
  generate_handbook:            "medium",

  // ── Validation: separate concurrency class ──
  validate_learning_content:    "validation",
  validate_blueprints:          "validation",
  validate_exam_pool:           "validation",
  validate_tutor_index:         "validation",
  validate_oral_exam:           "validation",
  validate_lesson_minichecks:   "validation",
  validate_handbook:            "validation",
  quality_council:              "validation",

  // ── Light: minimal pressure ──
  build_ai_tutor_index:         "light",
  run_integrity_check:          "light",
  auto_publish:                 "light",
};

/** Classify a step_key into its weight class. Unknown steps default to "medium". */
export function classifyStep(stepKey: string): StepWeightClass {
  return STEP_WEIGHT_MAP[stepKey as PipelineStepKey] ?? "medium";
}

/** Get all step keys for a given weight class */
export function stepsForClass(cls: StepWeightClass): PipelineStepKey[] {
  return (Object.entries(STEP_WEIGHT_MAP) as [PipelineStepKey, StepWeightClass][])
    .filter(([, c]) => c === cls)
    .map(([k]) => k);
}

// ═══════════════════════════════════════════════════════════════
// Phase A/B Concurrency Limits (env-overridable)
// ═══════════════════════════════════════════════════════════════

function envInt(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface StepClassLimits {
  heavy: number;
  medium: number;
  validation: number;
  light: number;
}

/** Phase A defaults: conservative. Env-overridable. */
export function getStepClassLimits(): StepClassLimits {
  return {
    heavy:      envInt("STEP_CLASS_HEAVY_MAX", 2),
    medium:     envInt("STEP_CLASS_MEDIUM_MAX", 3),
    validation: envInt("STEP_CLASS_VALIDATION_MAX", 1),
    light:      envInt("STEP_CLASS_LIGHT_MAX", 2),
  };
}

/** Total active package cap (Phase A = 6, Phase B = 8) */
export function getMaxActivePackages(): number {
  return envInt("MAX_ACTIVE_PACKAGES", 6);
}
