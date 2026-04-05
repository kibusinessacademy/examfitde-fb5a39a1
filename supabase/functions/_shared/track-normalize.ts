/**
 * Track Normalization (SSOT)
 * Canonical tracks + aliases → single canonical key.
 *
 * Edge-function version. Client-side mirror: src/lib/tracks.ts
 */

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST" | "STUDIUM";

const TRACK_ALIASES: Record<string, TrackKey> = {
  // ── Canonical ─────────────────────────────────────
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  EXAM_FIRST: "EXAM_FIRST",
  STUDIUM: "STUDIUM",

  // ── AUSBILDUNG_VOLL aliases ───────────────────────
  AUSBILDUNG: "AUSBILDUNG_VOLL",
  ELITE: "AUSBILDUNG_VOLL",
  "AUSBILDUNG-VOLL": "AUSBILDUNG_VOLL",
  AUSBILDUNG_VOLL_ELITE: "AUSBILDUNG_VOLL",
  FORTBILDUNG: "AUSBILDUNG_VOLL",
  ZERTIFIKAT: "AUSBILDUNG_VOLL",

  // ── EXAM_FIRST aliases ────────────────────────────
  EXAMFIRST: "EXAM_FIRST",
  "EXAM-FIRST": "EXAM_FIRST",

  // ── STUDIUM aliases ───────────────────────────────
  HIGHER_ED: "STUDIUM",
  HIGHER_EDUCATION: "STUDIUM",
  BACHELOR: "STUDIUM",
  MASTER: "STUDIUM",
  ACADEMIC: "STUDIUM",
};

export function normalizeTrack(input: unknown): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? "AUSBILDUNG_VOLL";
}
