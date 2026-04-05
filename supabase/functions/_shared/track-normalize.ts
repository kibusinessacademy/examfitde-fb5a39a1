/**
 * Track Normalization (SSOT)
 * Canonical tracks + aliases → single canonical key.
 *
 * Edge-function version. Client-side mirror: src/lib/tracks.ts
 */

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST" | "EXAM_FIRST_PLUS" | "STUDIUM";

const TRACK_ALIASES: Record<string, TrackKey> = {
  // ── Canonical ─────────────────────────────────────
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  EXAM_FIRST: "EXAM_FIRST",
  EXAM_FIRST_PLUS: "EXAM_FIRST_PLUS",
  STUDIUM: "STUDIUM",

  // ── AUSBILDUNG_VOLL aliases ───────────────────────
  AUSBILDUNG: "AUSBILDUNG_VOLL",
  ELITE: "AUSBILDUNG_VOLL",
  "AUSBILDUNG-VOLL": "AUSBILDUNG_VOLL",
  AUSBILDUNG_VOLL_ELITE: "AUSBILDUNG_VOLL",

  // ── EXAM_FIRST aliases ────────────────────────────
  EXAMFIRST: "EXAM_FIRST",
  "EXAM-FIRST": "EXAM_FIRST",

  // ── EXAM_FIRST_PLUS aliases ───────────────────────
  "EXAM-FIRST-PLUS": "EXAM_FIRST_PLUS",
  EXAMFIRSTPLUS: "EXAM_FIRST_PLUS",
  FORTBILDUNG: "EXAM_FIRST_PLUS",
  ZERTIFIKAT: "EXAM_FIRST_PLUS",

  // ── STUDIUM aliases ───────────────────────────────
  HIGHER_ED: "STUDIUM",
  HIGHER_EDUCATION: "STUDIUM",
  BACHELOR: "STUDIUM",
  MASTER: "STUDIUM",
  ACADEMIC: "STUDIUM",
};

/**
 * Tolerant normalization — falls back to default.
 */
export function normalizeTrack(input: unknown, fallback: TrackKey = "AUSBILDUNG_VOLL"): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? fallback;
}

/**
 * Strict normalization — throws on unknown track.
 * Use in pipeline/orchestration/admin-ops code.
 */
export function normalizeTrackStrict(input: unknown): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  const normalized = TRACK_ALIASES[raw];
  if (!normalized) {
    throw new Error(`Unknown track: ${raw || "<empty>"}`);
  }
  return normalized;
}
