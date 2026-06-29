/**
 * VISUAL.LEARNING.OS — Mastery Signal Policy (Cut 8).
 *
 * Frozen policy für Visual Mastery Signals. Pure: kein DB/HTTP/Clock/RNG/IO.
 *
 * HARTE REGELN:
 * - Visual Learning erzeugt nur erklärbare Signale, niemals finale Mastery.
 * - Keine Prüfungsreife-Aussage. Kein bestanden/nicht bestanden.
 * - Nur published Visual Artifacts dürfen Signale erzeugen.
 * - Keine Diagnose im Frontend. Keine direkten Client-Table-Reads.
 * - Learner sieht keine internen Score-Gewichte.
 */

export const VLO_MASTERY_BLOCKER_CODES = [
  "VLO_MASTERY_MISSING_CURRICULUM_ID",
  "VLO_MASTERY_MISSING_COMPETENCE_ID",
  "VLO_MASTERY_MISSING_LEARNER_CONTEXT",
  "VLO_MASTERY_UNPUBLISHED_ARTIFACT",
  "VLO_MASTERY_CURRICULUM_MISMATCH",
  "VLO_MASTERY_COMPETENCE_MISMATCH",
  "VLO_MASTERY_SOURCE_REFS_MISSING",
  "VLO_MASTERY_FRONTEND_DIAGNOSIS_FORBIDDEN",
  "VLO_MASTERY_DIRECT_TABLE_READ_FORBIDDEN",
  "VLO_MASTERY_EXAM_READINESS_CLAIM_FORBIDDEN",
  "VLO_MASTERY_SOLE_SCORE_DECISION_FORBIDDEN",
  "VLO_MASTERY_DRAFT_VISIBLE_TO_LEARNER",
] as const;
export type VloMasteryBlockerCode = (typeof VLO_MASTERY_BLOCKER_CODES)[number];

export const VLO_MASTERY_WARNING_CODES = [
  "VLO_MASTERY_LOW_SIGNAL_CONFIDENCE",
  "VLO_MASTERY_SPARSE_VISUAL_EVIDENCE",
  "VLO_MASTERY_REPEATED_MISCONCEPTION",
  "VLO_MASTERY_NO_PRIOR_SIGNAL",
  "VLO_MASTERY_TEXT_ONLY_FALLBACK",
] as const;
export type VloMasteryWarningCode = (typeof VLO_MASTERY_WARNING_CODES)[number];

export const VLO_MASTERY_SIGNAL_KINDS = [
  "strengthens_mastery",
  "weakens_mastery",
  "misconception_detected",
  "misconception_resolved",
  "needs_repetition",
] as const;
export type VloMasterySignalKind = (typeof VLO_MASTERY_SIGNAL_KINDS)[number];

export const VLO_MASTERY_CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type VloMasteryConfidenceBand = (typeof VLO_MASTERY_CONFIDENCE_BANDS)[number];

export interface VloMasteryBlocker {
  code: VloMasteryBlockerCode;
  detail: string;
}
export interface VloMasteryWarning {
  code: VloMasteryWarningCode;
  detail: string;
}

export const VLO_MASTERY_FORBIDDEN_BEHAVIORS = Object.freeze([
  "FINAL_MASTERY_FROM_VISUAL_ONLY",
  "EXAM_READINESS_CLAIM",
  "PASS_FAIL_CLAIM_FROM_VISUAL",
  "FRONTEND_DIAGNOSIS",
  "DIRECT_CLIENT_TABLE_READ",
  "DRAFT_OR_REVIEW_VISIBLE_TO_LEARNER",
  "AI_GENERATION_IN_CUT_8",
  "AUTO_PUBLISH_IN_CUT_8",
] as const);
export type VloMasteryForbiddenBehavior =
  (typeof VLO_MASTERY_FORBIDDEN_BEHAVIORS)[number];

export const FROZEN_VLO_MASTERY_SIGNAL_POLICY = Object.freeze({
  blockers: VLO_MASTERY_BLOCKER_CODES,
  warnings: VLO_MASTERY_WARNING_CODES,
  signal_kinds: VLO_MASTERY_SIGNAL_KINDS,
  confidence_bands: VLO_MASTERY_CONFIDENCE_BANDS,
  forbidden_behaviors: VLO_MASTERY_FORBIDDEN_BEHAVIORS,
  /** Max learner-visible hints per competence. */
  max_learner_hints_per_competence: 3,
  /** Repeated misconceptions threshold for needs_repetition. */
  repetition_threshold: 2,
  /** Minimum source_refs per artifact for high confidence. */
  min_source_refs_high_confidence: 1,
  /** Visual Learning is supplemental — never the sole decision. */
  is_supplemental_only: true,
});

export function isVloMasteryBlockerCode(v: string): v is VloMasteryBlockerCode {
  return (VLO_MASTERY_BLOCKER_CODES as readonly string[]).includes(v);
}

export function isVloMasteryWarningCode(v: string): v is VloMasteryWarningCode {
  return (VLO_MASTERY_WARNING_CODES as readonly string[]).includes(v);
}

export function isVloMasterySignalKind(v: string): v is VloMasterySignalKind {
  return (VLO_MASTERY_SIGNAL_KINDS as readonly string[]).includes(v);
}
