/**
 * Track Capability SSOT
 *
 * Single source of truth for what each track supports.
 * ALL track-dependent decisions must derive from this map.
 * Do NOT use raw `track === "..."` comparisons elsewhere.
 */
import { type Track, normalizeTrack } from "./tracks";

export type TrackCapabilities = {
  /** Full learning-course chain (scaffold → finalize → validate) */
  hasLearningCourse: boolean;
  /** Lesson mini-checks */
  hasMiniChecks: boolean;
  /** Handbook generation & validation */
  hasHandbook: boolean;
  /** Oral exam trainer */
  hasOralExam: boolean;
  /** Exam-centric: skips learning prerequisites */
  isExamCentric: boolean;
  /** Pure exam-only: no handbook, no oral */
  isExamOnly: boolean;
  /** Eligible for elite hardening pass */
  eliteHardenEligible: boolean;
  /** AI tutor mode key */
  tutorMode: "full" | "limited_exam" | "exam_only";
};

export const TRACK_CAPABILITIES: Record<Track, TrackCapabilities> = {
  AUSBILDUNG_VOLL: {
    hasLearningCourse: true,
    hasMiniChecks: true,
    hasHandbook: true,
    hasOralExam: false,
    isExamCentric: false,
    isExamOnly: false,
    eliteHardenEligible: false,
    tutorMode: "full",
  },
  EXAM_FIRST: {
    hasLearningCourse: false,
    hasMiniChecks: false,
    hasHandbook: false,
    hasOralExam: false,
    isExamCentric: true,
    isExamOnly: true,
    eliteHardenEligible: true,
    tutorMode: "exam_only",
  },
  EXAM_FIRST_PLUS: {
    hasLearningCourse: false,
    hasMiniChecks: false,
    hasHandbook: true,
    hasOralExam: true,
    isExamCentric: true,
    isExamOnly: false,
    eliteHardenEligible: true,
    tutorMode: "limited_exam",
  },
  STUDIUM: {
    hasLearningCourse: true,
    hasMiniChecks: true,
    hasHandbook: true,
    hasOralExam: false,
    isExamCentric: false,
    isExamOnly: false,
    eliteHardenEligible: false,
    tutorMode: "full",
  },
} as const;

/**
 * Get capabilities for any track input (normalizes aliases).
 */
export function getTrackCapabilities(track: unknown): TrackCapabilities {
  return TRACK_CAPABILITIES[normalizeTrack(track)];
}

// ── Convenience accessors (use these instead of raw comparisons) ──

export const cap = {
  hasLearningCourse: (t: unknown) => getTrackCapabilities(t).hasLearningCourse,
  hasMiniChecks: (t: unknown) => getTrackCapabilities(t).hasMiniChecks,
  hasHandbook: (t: unknown) => getTrackCapabilities(t).hasHandbook,
  hasOralExam: (t: unknown) => getTrackCapabilities(t).hasOralExam,
  isExamCentric: (t: unknown) => getTrackCapabilities(t).isExamCentric,
  isExamOnly: (t: unknown) => getTrackCapabilities(t).isExamOnly,
  eliteHardenEligible: (t: unknown) => getTrackCapabilities(t).eliteHardenEligible,
  tutorMode: (t: unknown) => getTrackCapabilities(t).tutorMode,
} as const;

// ── Step-level SSOT for track switches ──

/** Steps that must be SKIPPED for a given track */
export function getSkippedSteps(track: unknown): string[] {
  const c = getTrackCapabilities(track);
  const skipped: string[] = [];

  if (!c.hasLearningCourse) {
    skipped.push(
      "scaffold_learning_course",
      "fanout_learning_content",
      "generate_learning_content",
      "finalize_learning_content",
      "validate_learning_content",
    );
  }
  if (!c.hasMiniChecks) {
    skipped.push(
      "generate_lesson_minichecks",
      "validate_lesson_minichecks",
    );
  }

  return skipped;
}

/** Steps that must be ACTIVE for a given track */
export function getRequiredSteps(track: unknown): string[] {
  const c = getTrackCapabilities(track);
  const steps: string[] = [
    "auto_seed_exam_blueprints",
    "validate_blueprints",
    "generate_blueprint_variants",
    "validate_blueprint_variants",
    "promote_blueprint_variants",
    "generate_exam_pool",
    "validate_exam_pool",
    "build_ai_tutor_index",
    "validate_tutor_index",
    "run_integrity_check",
    "quality_council",
    "auto_publish",
  ];

  if (c.hasLearningCourse) {
    steps.push(
      "scaffold_learning_course",
      "fanout_learning_content",
      "generate_learning_content",
      "finalize_learning_content",
      "validate_learning_content",
    );
  }
  if (c.hasMiniChecks) {
    steps.push("generate_lesson_minichecks", "validate_lesson_minichecks");
  }
  if (c.hasHandbook) {
    steps.push(
      "generate_handbook",
      "validate_handbook",
      "enqueue_handbook_expand",
      "expand_handbook",
      "validate_handbook_depth",
    );
  }
  if (c.hasOralExam) {
    steps.push("generate_oral_exam", "validate_oral_exam");
  }
  if (c.eliteHardenEligible) {
    steps.push("elite_harden");
  }

  return steps;
}
