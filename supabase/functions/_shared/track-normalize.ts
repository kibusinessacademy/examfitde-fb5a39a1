/**
 * Track Normalization (SSOT)
 * Canonical tracks + aliases → single canonical key.
 */

export type TrackKey = "AUSBILDUNG_VOLL" | "EXAM_FIRST";

const TRACK_ALIASES: Record<string, TrackKey> = {
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  EXAM_FIRST: "EXAM_FIRST",
  ELITE: "AUSBILDUNG_VOLL",
  "AUSBILDUNG-VOLL": "AUSBILDUNG_VOLL",
  "AUSBILDUNG_VOLL_ELITE": "AUSBILDUNG_VOLL",
};

export function normalizeTrack(input: unknown): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? "AUSBILDUNG_VOLL";
}
