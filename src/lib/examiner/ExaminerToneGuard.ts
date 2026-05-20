/**
 * Phase 8.0 — Tone Enforcement (Runtime Guard).
 *
 * Verhindert Hype-, GenZ-, Motivations- und Manipulationssprache in
 * jeder prüferischen Aussage. Erweitert das statische Lexikon um
 * laufzeitprüfbare Regeln. SSOT für „Examiner Voice".
 */
import { FORBIDDEN_EXAMINER_TOKENS } from "@/lib/system/ExaminerLexicon";

export const HYPE_TOKENS = [
  "Mega",
  "Super",
  "Wow",
  "Krass",
  "Geil",
  "Awesome",
  "Hammer",
  "Top!",
  "Yes!",
  "Yay",
  "Boom",
  "Lit",
  "Slay",
  "Vibes",
  "Du schaffst das",
  "Keine Sorge",
  "Fast geschafft",
  "Bleib dran",
  "Glückwunsch",
  "Herzlichen Glückwunsch",
] as const;

export const EXAGGERATION_TOKENS = [
  "perfekt",
  "fehlerfrei",
  "100%ig",
  "garantiert",
  "auf jeden Fall",
  "unschlagbar",
  "absolut sicher",
  "todsicher",
] as const;

export interface ToneReport {
  ok: boolean;
  violations: Array<{ token: string; kind: "forbidden" | "hype" | "exaggeration" }>;
}

function findCaseInsensitive(text: string, token: string): boolean {
  if (!text || !token) return false;
  return text.toLowerCase().includes(token.toLowerCase());
}

export function assertExaminerTone(text: string): ToneReport {
  const violations: ToneReport["violations"] = [];
  for (const t of FORBIDDEN_EXAMINER_TOKENS) {
    if (findCaseInsensitive(text, t)) violations.push({ token: t, kind: "forbidden" });
  }
  for (const t of HYPE_TOKENS) {
    if (findCaseInsensitive(text, t)) violations.push({ token: t, kind: "hype" });
  }
  for (const t of EXAGGERATION_TOKENS) {
    if (findCaseInsensitive(text, t)) violations.push({ token: t, kind: "exaggeration" });
  }
  return { ok: violations.length === 0, violations };
}

/** Bequemer Helper für Batch-Prüfung mehrerer Aussagen. */
export function assertExaminerToneBatch(texts: string[]): ToneReport {
  const all: ToneReport["violations"] = [];
  for (const t of texts) {
    const r = assertExaminerTone(t);
    if (!r.ok) all.push(...r.violations);
  }
  return { ok: all.length === 0, violations: all };
}
