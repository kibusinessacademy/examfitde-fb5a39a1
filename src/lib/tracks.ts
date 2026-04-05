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

export function normalizeTrack(input: unknown): Track {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? "AUSBILDUNG_VOLL";
}

export function isAcademicTrack(track: unknown): boolean {
  return normalizeTrack(track) === "STUDIUM";
}

export function isExamFirstTrack(track: unknown): boolean {
  const t = normalizeTrack(track);
  return t === "EXAM_FIRST" || t === "EXAM_FIRST_PLUS";
}

export function isExamFirstPlusTrack(track: unknown): boolean {
  return normalizeTrack(track) === "EXAM_FIRST_PLUS";
}

export function isFullVocationalTrack(track: unknown): boolean {
  return normalizeTrack(track) === "AUSBILDUNG_VOLL";
}
