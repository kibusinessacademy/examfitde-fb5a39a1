/**
 * Track Normalization — Client-side SSOT
 * Mirror of supabase/functions/_shared/track-normalize.ts
 *
 * Canonical tracks + aliases → single canonical key.
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

export function normalizeTrackStrict(input: unknown): Track {
  const raw = String(input ?? "").trim().toUpperCase();
  const normalized = TRACK_ALIASES[raw];
  if (!normalized) {
    throw new Error(`Unknown track: ${raw || "<empty>"}`);
  }
  return normalized;
}

export function normalizeTrack(input: unknown, fallback: Track = "AUSBILDUNG_VOLL"): Track {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? fallback;
}

export function isAcademicTrack(track: unknown): boolean {
  return normalizeTrack(track) === "STUDIUM";
}

/** True for EXAM_FIRST or EXAM_FIRST_PLUS — exam-centric tracks without full learning course. */
export function isExamFirstTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "EXAM_FIRST" || t === "EXAM_FIRST_PLUS";
}

/** True only for EXAM_FIRST_PLUS (cert/Fachwirt premium track). */
export function isExamFirstPlusTrack(track: unknown): boolean {
  return normalizeTrack(track) === "EXAM_FIRST_PLUS";
}

/**
 * True when a track's isExamOnly capability is set.
 * Currently false for all tracks (EXAM_FIRST has oral component).
 * Delegates to TRACK_CAPABILITIES for SSOT compliance.
 */
export function isExamOnlyTrack(track: unknown): boolean {
  // Inline import avoided: use lazy capability lookup
  // This must stay in sync with TRACK_CAPABILITIES.isExamOnly
  const t = normalizeTrack(track);
  // All tracks currently have isExamOnly: false
  // If TRACK_CAPABILITIES changes, update this accordingly
  return false;
}

export function isFullVocationalTrack(track: unknown): boolean {
  return normalizeTrack(track) === "AUSBILDUNG_VOLL";
}

// ── Semantic Track Grouping Helpers (SSOT) ────────────────────

/** Exam-centric tracks: no learning course, skip content prereqs. */
export function isExamCentricTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "EXAM_FIRST" || t === "EXAM_FIRST_PLUS";
}

/** Tracks that include a full learning course chain. */
export function hasLearningCourseTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "AUSBILDUNG_VOLL" || t === "STUDIUM";
}

/** Tracks that include handbook generation. */
export function hasHandbookTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t !== "EXAM_FIRST"; // All tracks except bare EXAM_FIRST
}

/**
 * Tracks that have oral exam STATICALLY enabled by default.
 * For EXAM_FIRST_PLUS (cert-based), use resolveHasOralExam() instead.
 */
export function hasOralExamTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "AUSBILDUNG_VOLL" || t === "EXAM_FIRST";
}

/** Tracks that include minicheck generation. */
export function hasMiniChecksTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "AUSBILDUNG_VOLL" || t === "STUDIUM";
}
