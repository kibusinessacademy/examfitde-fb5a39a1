/**
 * SSOT: Capability → Step mapping for DAG gating
 *
 * Maps downstream step keys to the capability flag they require
 * from validate_learning_content's capabilities object.
 * Used by pipeline-helpers.ts to allow selective downstream
 * even when validate_learning_content is not fully "done".
 */

import type { LearningContentCapabilities } from "./learning-content-capabilities.ts";

/**
 * Maps step_key to the capability key it requires.
 * Only steps directly downstream of validate_learning_content are listed.
 */
const STEP_CAPABILITY_MAP: Record<string, keyof LearningContentCapabilities> = {
  auto_seed_exam_blueprints: "allowsBlueprintSeeding",
  generate_lesson_minichecks: "allowsMiniCheckGeneration",
  generate_handbook: "allowsHandbookGeneration",
  // Transitive downstream: inherit from their direct parent's capability
  // generate_exam_pool inherits from auto_seed_exam_blueprints chain
  // build_ai_tutor_index requires allowsTutorIndexing but depends on validate_exam_pool, not directly on validate_learning_content
};

/**
 * Check if a step is capability-granted by validate_learning_content
 * even though the validation step is not in "done" status.
 *
 * This enables selective downstream for repair_required packages
 * with sufficient content coverage.
 */
export function isCapabilityGranted(
  stepKey: string,
  validateStepMeta: Record<string, unknown> | null,
): boolean {
  const capKey = STEP_CAPABILITY_MAP[stepKey];
  if (!capKey) return false;

  const capabilities = validateStepMeta?.capabilities as LearningContentCapabilities | undefined;
  if (!capabilities) return false;

  return capabilities[capKey] === true;
}
