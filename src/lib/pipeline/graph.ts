/**
 * Pipeline DAG — Client-side track-aware graph resolver.
 *
 * Single master DAG (mirrors PIPELINE_GRAPH in job-map.ts).
 * For a given track, resolves to only the active nodes + filtered dependencies.
 */

import type { StepKey } from "./stepPolicy";
import { isStepRequiredForTrack } from "./stepPolicy";

export interface PipelineNode {
  key: StepKey;
  dependsOn: StepKey[];
}

/**
 * Master DAG — dependency edges only.
 * Must stay in sync with PIPELINE_GRAPH in _shared/job-map.ts.
 */
export const PIPELINE_GRAPH: PipelineNode[] = [
  { key: "scaffold_learning_course", dependsOn: [] },
  { key: "generate_glossary", dependsOn: ["scaffold_learning_course"] },
  { key: "fanout_learning_content", dependsOn: ["scaffold_learning_course"] },
  { key: "generate_learning_content", dependsOn: ["fanout_learning_content"] },
  { key: "finalize_learning_content", dependsOn: ["generate_learning_content"] },
  { key: "validate_learning_content", dependsOn: ["finalize_learning_content"] },

  { key: "auto_seed_exam_blueprints", dependsOn: ["validate_learning_content"] },
  { key: "validate_blueprints", dependsOn: ["auto_seed_exam_blueprints"] },
  { key: "generate_blueprint_variants", dependsOn: ["validate_blueprints"] },
  { key: "validate_blueprint_variants", dependsOn: ["generate_blueprint_variants"] },
  { key: "promote_blueprint_variants", dependsOn: ["validate_blueprint_variants"] },
  { key: "generate_exam_pool", dependsOn: ["promote_blueprint_variants"] },
  { key: "validate_exam_pool", dependsOn: ["generate_exam_pool"] },
  { key: "repair_exam_pool_quality", dependsOn: ["generate_exam_pool"] },

  { key: "build_ai_tutor_index", dependsOn: ["validate_exam_pool"] },
  { key: "validate_tutor_index", dependsOn: ["build_ai_tutor_index"] },

  { key: "generate_oral_exam", dependsOn: ["validate_tutor_index"] },
  { key: "validate_oral_exam", dependsOn: ["generate_oral_exam"] },

  { key: "generate_lesson_minichecks", dependsOn: ["validate_learning_content"] },
  { key: "validate_lesson_minichecks", dependsOn: ["generate_lesson_minichecks"] },

  { key: "generate_handbook", dependsOn: ["validate_learning_content"] },
  { key: "validate_handbook", dependsOn: ["generate_handbook"] },
  { key: "enqueue_handbook_expand", dependsOn: ["validate_handbook"] },
  { key: "expand_handbook", dependsOn: ["enqueue_handbook_expand"] },
  { key: "validate_handbook_depth", dependsOn: ["expand_handbook"] },

  { key: "elite_harden", dependsOn: ["validate_exam_pool"] },
  { key: "run_integrity_check", dependsOn: [
    "elite_harden",
    "validate_lesson_minichecks",
    "validate_handbook_depth",
    "validate_oral_exam",
    "validate_tutor_index",
  ]},
  { key: "quality_council", dependsOn: ["run_integrity_check"] },
  { key: "auto_publish", dependsOn: ["quality_council"] },
];

/**
 * Resolves the active DAG for a track:
 * - Removes nodes for skipped steps
 * - Filters dependency edges to only reference active nodes
 */
export function getActiveGraphForTrack(track: unknown): PipelineNode[] {
  const activeKeys = new Set(
    PIPELINE_GRAPH
      .map((n) => n.key)
      .filter((key) => isStepRequiredForTrack(key, track)),
  );

  return PIPELINE_GRAPH
    .filter((node) => activeKeys.has(node.key))
    .map((node) => ({
      ...node,
      dependsOn: node.dependsOn.filter((dep) => activeKeys.has(dep)),
    }));
}
