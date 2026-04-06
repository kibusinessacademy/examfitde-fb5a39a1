/**
 * Track Capability SSOT — Edge Function mirror
 * Keep in sync with src/lib/track-capabilities.ts
 */

export const TRACKS = [
  "AUSBILDUNG_VOLL",
  "EXAM_FIRST",
  "EXAM_FIRST_PLUS",
  "STUDIUM",
] as const;

export type Track = (typeof TRACKS)[number];

const TRACK_ALIASES: Record<string, Track> = {
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  AUSBILDUNG: "AUSBILDUNG_VOLL",
  "AUSBILDUNG-VOLL": "AUSBILDUNG_VOLL",
  AUSBILDUNG_VOLL_ELITE: "AUSBILDUNG_VOLL",
  ELITE: "AUSBILDUNG_VOLL",

  EXAM_FIRST: "EXAM_FIRST",
  EXAMFIRST: "EXAM_FIRST",
  "EXAM-FIRST": "EXAM_FIRST",

  EXAM_FIRST_PLUS: "EXAM_FIRST_PLUS",
  "EXAM-FIRST-PLUS": "EXAM_FIRST_PLUS",
  EXAMFIRSTPLUS: "EXAM_FIRST_PLUS",
  FORTBILDUNG: "EXAM_FIRST_PLUS",
  ZERTIFIKAT: "EXAM_FIRST_PLUS",

  STUDIUM: "STUDIUM",
  HIGHER_ED: "STUDIUM",
  HIGHER_EDUCATION: "STUDIUM",
  BACHELOR: "STUDIUM",
  MASTER: "STUDIUM",
  ACADEMIC: "STUDIUM",
};

/**
 * Strict normalization — throws on unknown track.
 * Use in pipeline/orchestration/admin-ops.
 */
export function normalizeTrackStrict(input: unknown): Track {
  const raw = String(input ?? "").trim().toUpperCase();
  const normalized = TRACK_ALIASES[raw];
  if (!normalized) {
    throw new Error(`Unknown track: ${raw || "<empty>"}`);
  }
  return normalized;
}

/**
 * Tolerant normalization — falls back to default.
 * Use in display/import code.
 */
export function normalizeTrack(input: unknown, fallback: Track = "AUSBILDUNG_VOLL"): Track {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? fallback;
}

export type TrackCapabilities = {
  hasLearningCourse: boolean;
  hasMiniChecks: boolean;
  hasHandbook: boolean;
  canSupportOralExam: boolean;
  hasOralExam: boolean;
  isExamCentric: boolean;
  isExamOnly: boolean;
  eliteHardenEligible: boolean;
  tutorMode: "full" | "limited_exam" | "exam_only";
};

export const TRACK_CAPABILITIES: Record<Track, TrackCapabilities> = {
  AUSBILDUNG_VOLL: {
    hasLearningCourse: true,
    hasMiniChecks: true,
    hasHandbook: true,
    canSupportOralExam: true,
    hasOralExam: true,
    isExamCentric: false,
    isExamOnly: false,
    eliteHardenEligible: false,
    tutorMode: "full",
  },
  EXAM_FIRST: {
    hasLearningCourse: false,
    hasMiniChecks: false,
    hasHandbook: false,
    canSupportOralExam: true,
    hasOralExam: true,
    isExamCentric: true,
    isExamOnly: false,
    eliteHardenEligible: true,
    tutorMode: "exam_only",
  },
  EXAM_FIRST_PLUS: {
    hasLearningCourse: false,
    hasMiniChecks: false,
    hasHandbook: true,
    canSupportOralExam: true,
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
    canSupportOralExam: true,
    hasOralExam: false,
    isExamCentric: false,
    isExamOnly: false,
    eliteHardenEligible: false,
    tutorMode: "full",
  },
};

export function getTrackCapabilities(track: unknown): TrackCapabilities {
  return TRACK_CAPABILITIES[normalizeTrack(track)];
}

/** Steps that must be SKIPPED for a given track (fully symmetric) */
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
    skipped.push("generate_lesson_minichecks", "validate_lesson_minichecks");
  }
  if (!c.hasHandbook) {
    skipped.push(
      "generate_handbook",
      "validate_handbook",
      "enqueue_handbook_expand",
      "expand_handbook",
      "validate_handbook_depth",
    );
  }
  if (!c.hasOralExam) {
    skipped.push("generate_oral_exam", "validate_oral_exam");
  }
  if (!c.eliteHardenEligible) {
    skipped.push("elite_harden");
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
      "scaffold_learning_course", "fanout_learning_content",
      "generate_learning_content", "finalize_learning_content",
      "validate_learning_content",
    );
  }
  if (c.hasMiniChecks) steps.push("generate_lesson_minichecks", "validate_lesson_minichecks");
  if (c.hasHandbook) steps.push("generate_handbook", "validate_handbook", "enqueue_handbook_expand", "expand_handbook", "validate_handbook_depth");
  if (c.hasOralExam) steps.push("generate_oral_exam", "validate_oral_exam");
  if (c.eliteHardenEligible) steps.push("elite_harden");
  return steps;
}
