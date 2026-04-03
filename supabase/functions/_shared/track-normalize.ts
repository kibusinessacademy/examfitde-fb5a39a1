/**
 * Track Normalization (SSOT)
 * Canonical tracks + aliases → single canonical key.
 */

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST" | "STUDIUM";

const TRACK_ALIASES: Record<string, TrackKey> = {
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  EXAM_FIRST: "EXAM_FIRST",
  STUDIUM: "STUDIUM",
  ELITE: "AUSBILDUNG_VOLL",
  "AUSBILDUNG-VOLL": "AUSBILDUNG_VOLL",
  "AUSBILDUNG_VOLL_ELITE": "AUSBILDUNG_VOLL",
  "HIGHER_ED": "STUDIUM",
  "HIGHER_EDUCATION": "STUDIUM",
  "BACHELOR": "STUDIUM",
  "MASTER": "STUDIUM",
};

export function normalizeTrack(input: unknown): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? "AUSBILDUNG_VOLL";
}
