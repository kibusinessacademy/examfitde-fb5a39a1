/**
 * Track Capability SSOT
 *
 * Single source of truth for what each track supports.
 * ALL track-dependent decisions must derive from this map.
 * Do NOT use raw `track === "..."` comparisons elsewhere.
 *
 * IMPORTANT: For EXAM_FIRST_PLUS, `hasOralExam` is `false` because
 * oral exam activation is cert-based. Use `resolveHasOralExam()` to
 * determine the effective state at runtime.
 */
import { type Track, normalizeTrack } from "./tracks";

export type TrackCapabilities = {
  /** Full learning-course chain (scaffold → finalize → validate) */
  hasLearningCourse: boolean;
  /** Lesson mini-checks */
  hasMiniChecks: boolean;
  /** Handbook generation & validation */
  hasHandbook: boolean;
  /** Track CAN support oral exam (capability ceiling) */
  canSupportOralExam: boolean;
  /** Oral exam trainer active by DEFAULT for this track (static).
   *  For cert-based tracks (EXAM_FIRST_PLUS), this is false —
   *  use resolveHasOralExam() for the effective value. */
  hasOralExam: boolean;
  /** Exam-centric: skips learning prerequisites */
  isExamCentric: boolean;
  /** Minimal exam track: no handbook */
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
    hasOralExam: false, // cert-based — use resolveHasOralExam()
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
} as const;

/**
 * Get capabilities for any track input (normalizes aliases).
 */
export function getTrackCapabilities(track: unknown): TrackCapabilities {
  return TRACK_CAPABILITIES[normalizeTrack(track)];
}

// ── Certification context for cert-based oral exam resolution ──

export type CertificationContext = {
  oral_exam_enabled?: boolean | null;
};

/**
 * Resolve effective oral exam state.
 *
 * - AUSBILDUNG_VOLL / EXAM_FIRST: always true (static default)
 * - EXAM_FIRST_PLUS: true only if certification.oral_exam_enabled === true
 * - STUDIUM: always false (canSupportOralExam but no exam tradition)
 *
 * This is the ONLY function that should be used for runtime oral exam decisions.
 */
export function resolveHasOralExam(
  track: unknown,
  certification?: CertificationContext | null,
): boolean {
  const c = getTrackCapabilities(track);
  if (!c.canSupportOralExam) return false;

  // Static default tracks — oral exam is unconditionally on/off
  if (c.hasOralExam) return true;

  // Cert-based tracks (EXAM_FIRST_PLUS) — only if certification says so
  const t = normalizeTrack(track);
  if (t === "EXAM_FIRST_PLUS") {
    return certification?.oral_exam_enabled === true;
  }

  // STUDIUM and any future tracks with hasOralExam:false
  return false;
}

// ── Convenience accessors (use these instead of raw comparisons) ──

export const cap = {
  hasLearningCourse: (t: unknown) => getTrackCapabilities(t).hasLearningCourse,
  hasMiniChecks: (t: unknown) => getTrackCapabilities(t).hasMiniChecks,
  hasHandbook: (t: unknown) => getTrackCapabilities(t).hasHandbook,
  canSupportOralExam: (t: unknown) => getTrackCapabilities(t).canSupportOralExam,
  /** Static default only — for runtime decisions use resolveHasOralExam() */
  hasOralExam: (t: unknown) => getTrackCapabilities(t).hasOralExam,
  isExamCentric: (t: unknown) => getTrackCapabilities(t).isExamCentric,
  isExamOnly: (t: unknown) => getTrackCapabilities(t).isExamOnly,
  eliteHardenEligible: (t: unknown) => getTrackCapabilities(t).eliteHardenEligible,
  tutorMode: (t: unknown) => getTrackCapabilities(t).tutorMode,
} as const;

// ── Step-level SSOT for track switches ──

export type TrackResolutionContext = {
  track: unknown;
  certification?: CertificationContext | null;
};

/** Steps that must be SKIPPED for a given track + certification context */
export function getSkippedSteps(
  trackOrCtx: unknown | TrackResolutionContext,
  certification?: CertificationContext | null,
): string[] {
  const { track, cert } = normalizeCtxArgs(trackOrCtx, certification);
  const c = getTrackCapabilities(track);
  const effectiveOral = resolveHasOralExam(track, cert);
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
  if (!c.hasHandbook) {
    skipped.push(
      "generate_handbook",
      "validate_handbook",
      "enqueue_handbook_expand",
      "expand_handbook",
      "validate_handbook_depth",
    );
  }
  if (!effectiveOral) {
    skipped.push(
      "generate_oral_exam",
      "validate_oral_exam",
    );
  }
  if (!c.eliteHardenEligible) {
    skipped.push("elite_harden");
  }

  return skipped;
}

/** Steps that must be ACTIVE for a given track + certification context */
export function getRequiredSteps(
  trackOrCtx: unknown | TrackResolutionContext,
  certification?: CertificationContext | null,
): string[] {
  const { track, cert } = normalizeCtxArgs(trackOrCtx, certification);
  const c = getTrackCapabilities(track);
  const effectiveOral = resolveHasOralExam(track, cert);
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
  if (effectiveOral) {
    steps.push("generate_oral_exam", "validate_oral_exam");
  }
  if (c.eliteHardenEligible) {
    steps.push("elite_harden");
  }

  return steps;
}

// ── Internal helper ──

function normalizeCtxArgs(
  trackOrCtx: unknown,
  certification?: CertificationContext | null,
): { track: unknown; cert: CertificationContext | null | undefined } {
  if (
    trackOrCtx != null &&
    typeof trackOrCtx === "object" &&
    "track" in (trackOrCtx as Record<string, unknown>)
  ) {
    const ctx = trackOrCtx as TrackResolutionContext;
    return { track: ctx.track, cert: ctx.certification };
  }
  return { track: trackOrCtx, cert: certification };
}
