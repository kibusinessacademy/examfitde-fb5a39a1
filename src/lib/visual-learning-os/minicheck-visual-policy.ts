/**
 * VISUAL.LEARNING.OS — MiniCheck Visual Feedback Policy (Cut 5).
 *
 * Frozen Blocker- und Warning-Codes für die MiniCheck → Visual Misconception
 * Verknüpfung. Pure: kein DB/HTTP/Clock/RNG/IO.
 *
 * HARTE REGELN:
 * - Frontend darf keine fachliche Fehlerdiagnose erfinden.
 * - Nur vorgegebene Mapping-IDs erzeugen Feedback.
 * - Drafts/needs_review niemals an Lernende.
 * - Keine Mastery-/Prüfungsreife-Aussage in Cut 5.
 */

export const MINICHECK_VISUAL_BLOCKER_CODES = [
  "MINICHECK_VISUAL_MISSING_CURRICULUM_ID",
  "MINICHECK_VISUAL_MISSING_COMPETENCE_ID",
  "MINICHECK_VISUAL_MISSING_MINICHECK_ID",
  "MINICHECK_VISUAL_MISSING_QUESTION_ID",
  "MINICHECK_VISUAL_UNAPPROVED_ARTIFACT",
  "MINICHECK_VISUAL_CURRICULUM_MISMATCH",
  "MINICHECK_VISUAL_COMPETENCE_MISMATCH",
  "MINICHECK_VISUAL_LESSON_MISMATCH",
  "MINICHECK_VISUAL_SOURCE_REFS_MISSING",
  "MINICHECK_VISUAL_FRONTEND_DIAGNOSIS_FORBIDDEN",
  "MINICHECK_VISUAL_DIRECT_TABLE_READ_FORBIDDEN",
  "MINICHECK_VISUAL_DRAFT_VISIBLE_TO_LEARNER",
  "MINICHECK_VISUAL_COLOR_ONLY_MEANING",
] as const;
export type MiniCheckVisualBlockerCode = (typeof MINICHECK_VISUAL_BLOCKER_CODES)[number];

export const MINICHECK_VISUAL_WARNING_CODES = [
  "MINICHECK_VISUAL_NO_MAPPING_AVAILABLE",
  "MINICHECK_VISUAL_NO_MISCONCEPTION_MATCH",
  "MINICHECK_VISUAL_SPARSE_SOURCE_REFS",
  "MINICHECK_VISUAL_ARTIFACT_WITHOUT_MISCONCEPTIONS",
  "MINICHECK_VISUAL_FEEDBACK_TEXT_ONLY_FALLBACK",
] as const;
export type MiniCheckVisualWarningCode = (typeof MINICHECK_VISUAL_WARNING_CODES)[number];

export interface MiniCheckVisualBlocker {
  code: MiniCheckVisualBlockerCode;
  detail: string;
}
export interface MiniCheckVisualWarning {
  code: MiniCheckVisualWarningCode;
  detail: string;
}

export const FROZEN_MINICHECK_VISUAL_POLICY = Object.freeze({
  blockers: MINICHECK_VISUAL_BLOCKER_CODES,
  warnings: MINICHECK_VISUAL_WARNING_CODES,
  /** Maximale Anzahl primärer Feedback-Items pro Result. */
  max_primary_feedback_items: 3,
  /** Mindestanzahl source_refs, darunter wird Warning ausgelöst. */
  min_source_refs: 1,
});

export function isMiniCheckVisualBlockerCode(
  v: string,
): v is MiniCheckVisualBlockerCode {
  return (MINICHECK_VISUAL_BLOCKER_CODES as readonly string[]).includes(v);
}

export function isMiniCheckVisualWarningCode(
  v: string,
): v is MiniCheckVisualWarningCode {
  return (MINICHECK_VISUAL_WARNING_CODES as readonly string[]).includes(v);
}
