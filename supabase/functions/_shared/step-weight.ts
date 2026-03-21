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
  expand_handbook:              "heavy",     // LLM-intensive per-section expansion

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
  validate_handbook_depth:      "validation",
  quality_council:              "validation",

  // ── Light: minimal pressure ──
  fanout_learning_content:      "light",     // Pure orchestration, creates shards
  finalize_learning_content:    "light",     // Pure barrier check, no LLM
  build_ai_tutor_index:         "light",
  run_integrity_check:          "light",
  auto_publish:                 "light",
  enqueue_handbook_expand:      "light",     // Pure orchestration, no LLM
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

/** Phase D defaults: scaled for 15-package WIP. Env-overridable. */
export function getStepClassLimits(): StepClassLimits {
  return {
    heavy:      envInt("STEP_CLASS_HEAVY_MAX", 8),    // Phase D: 4→8 (15 WIP needs more heavy slots)
    medium:     envInt("STEP_CLASS_MEDIUM_MAX", 6),    // Phase D: 3→6
    validation: envInt("STEP_CLASS_VALIDATION_MAX", 6), // Phase D: 3→6 (finish-line priority)
    light:      envInt("STEP_CLASS_LIGHT_MAX", 8),      // Phase D: 3→8 (finalize + integrity must never starve)
  };
}

/** Total active package cap (Phase D = 15, matching WIP_TOTAL_CAP) */
export function getMaxActivePackages(): number {
  return envInt("MAX_ACTIVE_PACKAGES", 15);
}
