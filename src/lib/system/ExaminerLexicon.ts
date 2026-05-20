/**
 * Phase 7.1 — Examiner Lexicon (SSOT für prüferische Sprache).
 *
 * Eine einzige Wahrheit über erlaubte und verbotene Begriffe in
 * Examiner-Surfaces. Keine Surface darf eigene prüferische Sprache
 * erfinden. Wird vom statischen Guard `examiner-copy-governance` und
 * vom Runtime-Coherence-Check konsumiert.
 */

/** Begriffe, die in Examiner-/App-Surfaces nicht auftauchen dürfen. */
export const FORBIDDEN_EXAMINER_TOKENS = [
  "Quiz",
  "Kursfortschritt",
  "Kapitel",
  "Punktejagd",
  "XP",
  "Levelup",
  "Level up",
  "Gamification",
  "Aufgabenliste",
  "To-do",
  "Todo",
  "Streak",
  "Badge",
  "High Score",
  "Highscore",
] as const;

/** Erlaubte prüferische Sprache — definiert die Produktidentität. */
export const ALLOWED_EXAMINER_VOCABULARY = [
  "Prüfungszustand",
  "Stabilität",
  "Transferreaktion",
  "Belastungsstabilität",
  "Rückfragen-Risiko",
  "Prüfungsdramaturgie",
  "Deliberation",
  "Strategische Priorität",
  "Prüfungsreife",
  "Risikoentwicklung",
  "Prüferische Einschätzung",
] as const;

/** Surfaces, die unter Examiner-Governance fallen. */
export const EXAMINER_SURFACE_GLOBS = [
  "src/pages/app/**/*.{ts,tsx}",
  "src/pages/quiz/QuizResultPage.tsx",
  "src/components/system/**/*.{ts,tsx}",
  "src/lib/system/**/*.{ts,tsx}",
] as const;

export type ForbiddenToken = (typeof FORBIDDEN_EXAMINER_TOKENS)[number];
