/**
 * VISUAL.LEARNING.OS — Assessment Rubrics (Cut 1).
 *
 * Standard-Rubrics pro Artefakt-Typ. Summe der Gewichte = 100.
 * Wird in Cut 2 von der Visual Assessment Engine konsumiert.
 */
import type { VisualArtifactType, VisualAssessmentRubric } from "./contracts";

export const DEFAULT_RUBRICS: Record<VisualArtifactType, VisualAssessmentRubric> = {
  concept_map: {
    passing_score: 70,
    checks: [
      { kind: "node_grouping_correct", weight: 30 },
      { kind: "edge_relation_correct", weight: 40 },
      { kind: "misconception_avoided", weight: 20 },
      { kind: "explanation_quality", weight: 10 },
    ],
  },
  process_flow: {
    passing_score: 75,
    checks: [
      { kind: "sequence_correct", weight: 50 },
      { kind: "node_position_correct", weight: 20 },
      { kind: "misconception_avoided", weight: 20 },
      { kind: "explanation_quality", weight: 10 },
    ],
  },
  decision_tree: {
    passing_score: 75,
    checks: [
      { kind: "edge_relation_correct", weight: 40 },
      { kind: "sequence_correct", weight: 25 },
      { kind: "misconception_avoided", weight: 25 },
      { kind: "explanation_quality", weight: 10 },
    ],
  },
  comparison_matrix: {
    passing_score: 70,
    checks: [
      { kind: "node_grouping_correct", weight: 50 },
      { kind: "edge_relation_correct", weight: 20 },
      { kind: "misconception_avoided", weight: 20 },
      { kind: "explanation_quality", weight: 10 },
    ],
  },
  timeline: {
    passing_score: 75,
    checks: [
      { kind: "sequence_correct", weight: 60 },
      { kind: "node_position_correct", weight: 20 },
      { kind: "misconception_avoided", weight: 20 },
    ],
  },
  cause_effect_map: {
    passing_score: 70,
    checks: [
      { kind: "edge_relation_correct", weight: 50 },
      { kind: "node_grouping_correct", weight: 20 },
      { kind: "misconception_avoided", weight: 20 },
      { kind: "explanation_quality", weight: 10 },
    ],
  },
  error_map: {
    passing_score: 70,
    checks: [
      { kind: "misconception_avoided", weight: 60 },
      { kind: "edge_relation_correct", weight: 20 },
      { kind: "explanation_quality", weight: 20 },
    ],
  },
  dashboard_interpretation: {
    passing_score: 70,
    checks: [
      { kind: "explanation_quality", weight: 50 },
      { kind: "misconception_avoided", weight: 30 },
      { kind: "node_grouping_correct", weight: 20 },
    ],
  },
  oral_whiteboard: {
    passing_score: 70,
    checks: [
      { kind: "explanation_quality", weight: 50 },
      { kind: "sequence_correct", weight: 20 },
      { kind: "edge_relation_correct", weight: 20 },
      { kind: "misconception_avoided", weight: 10 },
    ],
  },
};

/** Validiert, dass eine Rubric in sich konsistent ist (Summe = 100). */
export function validateRubric(rubric: VisualAssessmentRubric): { ok: boolean; reason?: string } {
  const sum = rubric.checks.reduce((s, c) => s + c.weight, 0);
  if (sum !== 100) return { ok: false, reason: `Gewichtssumme ${sum} ≠ 100` };
  if (rubric.passing_score < 0 || rubric.passing_score > 100) {
    return { ok: false, reason: "passing_score außerhalb 0..100" };
  }
  return { ok: true };
}
