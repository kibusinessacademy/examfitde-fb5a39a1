/**
 * VISUAL.LEARNING.OS — Oral Visual Policy (Cut 9).
 *
 * Frozen policy für strukturelles Feedback zu mündlichen Antworten auf Basis
 * published Visual Artifacts. Pure: kein DB/HTTP/Clock/RNG/IO.
 *
 * HARTE REGELN:
 * - Strukturhinweise ja, finale mündliche Prüfungsbewertung NIEMALS.
 * - Kein bestanden/nicht bestanden, keine Note, keine Prüfungsreife.
 * - Keine NLP-/LLM-Auswertung aus Freitext. Mapping nur über explizite IDs.
 * - Nur published Visual Artifacts dürfen verwendet werden.
 * - Keine Diagnose im Frontend. Keine direkten Client-Table-Reads.
 * - Draft-/Review-/AI-Draft-Artefakte sind nie learner-visible.
 */

export const VLO_ORAL_BLOCKER_CODES = [
  "VLO_ORAL_MISSING_CURRICULUM_ID",
  "VLO_ORAL_MISSING_COMPETENCE_ID",
  "VLO_ORAL_MISSING_ORAL_QUESTION_ID",
  "VLO_ORAL_MISSING_LEARNER_CONTEXT",
  "VLO_ORAL_UNPUBLISHED_ARTIFACT",
  "VLO_ORAL_CURRICULUM_MISMATCH",
  "VLO_ORAL_COMPETENCE_MISMATCH",
  "VLO_ORAL_BLUEPRINT_MISMATCH",
  "VLO_ORAL_SOURCE_REFS_MISSING",
  "VLO_ORAL_FRONTEND_EVALUATION_FORBIDDEN",
  "VLO_ORAL_DIRECT_TABLE_READ_FORBIDDEN",
  "VLO_ORAL_EXAM_GRADE_CLAIM_FORBIDDEN",
  "VLO_ORAL_EXAM_READINESS_CLAIM_FORBIDDEN",
  "VLO_ORAL_DRAFT_VISIBLE_TO_LEARNER",
  "VLO_ORAL_AI_DRAFT_VISIBLE_TO_LEARNER",
] as const;
export type VloOralBlockerCode = (typeof VLO_ORAL_BLOCKER_CODES)[number];

export const VLO_ORAL_WARNING_CODES = [
  "VLO_ORAL_NO_VISUAL_ARTIFACT_AVAILABLE",
  "VLO_ORAL_SPARSE_STRUCTURE_EVIDENCE",
  "VLO_ORAL_MISSING_KEY_NODE_COVERAGE",
  "VLO_ORAL_MISSING_EDGE_COVERAGE",
  "VLO_ORAL_REPEATED_MISCONCEPTION",
  "VLO_ORAL_TEXT_ONLY_FALLBACK",
] as const;
export type VloOralWarningCode = (typeof VLO_ORAL_WARNING_CODES)[number];

export const VLO_ORAL_SIGNAL_KINDS = [
  "structure_aligned",
  "key_node_missing",
  "relation_missing",
  "misconception_risk",
  "answer_too_unstructured",
  "needs_followup_question",
  "good_practice_reference",
] as const;
export type VloOralSignalKind = (typeof VLO_ORAL_SIGNAL_KINDS)[number];

export const VLO_ORAL_CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type VloOralConfidenceBand = (typeof VLO_ORAL_CONFIDENCE_BANDS)[number];

export interface VloOralBlocker {
  code: VloOralBlockerCode;
  detail: string;
}
export interface VloOralWarning {
  code: VloOralWarningCode;
  detail: string;
}

export const VLO_ORAL_FORBIDDEN_BEHAVIORS = Object.freeze([
  "FINAL_ORAL_GRADE_FROM_VISUAL",
  "PASS_FAIL_CLAIM_FROM_VISUAL",
  "EXAM_READINESS_CLAIM",
  "FREETEXT_NLP_EVALUATION",
  "FRONTEND_EVALUATION",
  "DIRECT_CLIENT_TABLE_READ",
  "DRAFT_OR_REVIEW_VISIBLE_TO_LEARNER",
  "AI_DRAFT_VISIBLE_TO_LEARNER",
  "AUTO_MASTERY_DECISION",
] as const);
export type VloOralForbiddenBehavior =
  (typeof VLO_ORAL_FORBIDDEN_BEHAVIORS)[number];

export const FROZEN_VLO_ORAL_VISUAL_POLICY = Object.freeze({
  blockers: VLO_ORAL_BLOCKER_CODES,
  warnings: VLO_ORAL_WARNING_CODES,
  signal_kinds: VLO_ORAL_SIGNAL_KINDS,
  confidence_bands: VLO_ORAL_CONFIDENCE_BANDS,
  forbidden_behaviors: VLO_ORAL_FORBIDDEN_BEHAVIORS,
  /** Max learner-visible hints per oral question. */
  max_learner_hints: 4,
  /** node coverage ratio < threshold → answer_too_unstructured. */
  unstructured_coverage_threshold: 0.34,
  /** node+edge coverage ratio ≥ threshold → structure_aligned. */
  aligned_coverage_threshold: 0.75,
  /** Pflicht: source_refs ≥ 1 für medium/high confidence. */
  min_source_refs_high_confidence: 1,
  /** Oral structural feedback ist supplemental — nie finale Bewertung. */
  is_supplemental_only: true,
  is_final_oral_grade: false,
});

export function isVloOralBlockerCode(v: string): v is VloOralBlockerCode {
  return (VLO_ORAL_BLOCKER_CODES as readonly string[]).includes(v);
}
export function isVloOralWarningCode(v: string): v is VloOralWarningCode {
  return (VLO_ORAL_WARNING_CODES as readonly string[]).includes(v);
}
export function isVloOralSignalKind(v: string): v is VloOralSignalKind {
  return (VLO_ORAL_SIGNAL_KINDS as readonly string[]).includes(v);
}
