/**
 * VISUAL.LEARNING.OS — Lesson Visual Policy (Cut 4).
 *
 * Frozen Blocker- und Warning-Codes für die Lesson-Integration.
 * Pure: kein DB/HTTP/Clock/RNG/IO.
 */

export const VISUAL_LESSON_BLOCKER_CODES = [
  "VISUAL_LESSON_CURRICULUM_MISMATCH",
  "VISUAL_LESSON_COMPETENCE_MISMATCH",
  "VISUAL_LESSON_LESSON_MISMATCH",
  "VISUAL_LESSON_UNAPPROVED_ARTIFACT",
  "VISUAL_LESSON_DRAFT_VISIBLE_TO_LEARNER",
  "VISUAL_LESSON_FRONTEND_PATTERN_LOGIC",
  "VISUAL_LESSON_DIRECT_TABLE_READ",
  "VISUAL_LESSON_COLOR_ONLY_MEANING",
] as const;
export type VisualLessonBlockerCode = (typeof VISUAL_LESSON_BLOCKER_CODES)[number];

export const VISUAL_LESSON_WARNING_CODES = [
  "VISUAL_LESSON_NO_ARTIFACT_AVAILABLE",
  "VISUAL_LESSON_NO_MISCONCEPTION_COVERAGE",
  "VISUAL_LESSON_TOO_MANY_SUPPORTING_VISUALS",
  "VISUAL_LESSON_SOURCE_REFS_SPARSE",
] as const;
export type VisualLessonWarningCode = (typeof VISUAL_LESSON_WARNING_CODES)[number];

export const FROZEN_LESSON_VISUAL_POLICY = Object.freeze({
  blockers: VISUAL_LESSON_BLOCKER_CODES,
  warnings: VISUAL_LESSON_WARNING_CODES,
  /** Maximale Anzahl supporting visuals pro Placement. */
  max_supporting_visuals: 3,
  /** Maximale Primary-Visuals pro Placement (hart). */
  max_primary_visuals: 1,
});
