/**
 * P0.4 Surface-Signals SSOT.
 * ──────────────────────────────────────────────────────────────────────
 * Shared regex catalogue the Learner-Reality specs use to decide
 * whether a feature surface (MiniCheck / Tutor / Oral) shows
 * fachlich nutzbaren Inhalt — even when the in-engine flow isn't
 * reachable (no curriculum, no enrollment, RLS-stalled, etc.).
 *
 * A surface counts as "P0-clean" if EITHER the live engine renders
 * OR a fachlich sinnvoller Recovery-State (Start-CTA + Beruf-Wahl)
 * renders. A bare spinner, naked "Keine Daten", or pure nav chrome
 * is NEVER acceptable.
 *
 * Do not add Mocks/Fake-questions here — the signals describe what
 * the *real* surface must contain, not what a fake renderer fakes.
 */

export const MINICHECK_SIGNALS: RegExp[] = [
  /minicheck/i,
  /kompetenz-?check/i,
  /wissens-?check/i,
  /frage/i,
  /antwort/i,
  /weiter/i,
  /starten/i,
  /lernstand/i,
];

export const TUTOR_SIGNALS: RegExp[] = [
  /tutor/i,
  /frage stellen/i,
  /frage senden/i,
  /coach/i,
  /erklärer/i,
  /prüfer/i,
  /senden/i,
  /quellen/i,
];

export const ORAL_SIGNALS: RegExp[] = [
  /mündliche prüfung/i,
  /oral/i,
  /simulation starten/i,
  /prüfungsfrage/i,
  /prüfungstraining wählen/i,
  /fachlichkeit/i,
  /struktur/i,
  /begriffssicherheit/i,
  /praxisbezug/i,
];

/** Stable CTA test-ids exposed by the Reality-QA entry surfaces. */
export const SURFACE_TESTIDS = {
  miniCheckStart: 'minicheck-start-cta',
  miniCheckAnchor: 'minicheck-static-anchor',
  tutorInput: 'tutor-input',
  tutorForm: 'tutor-entry-form',
  oralSurface: 'oral-exam-surface',
  oralStart: 'oral-start-cta',
  oralRecovery: 'oral-recovery-cta',
} as const;

/**
 * Returns true when `body` matches at least `minMatches` signals AND
 * has ≥ `minBody` chars of visible text. Used by the reality specs to
 * accept a fachlich sinnvolle Fallback-Surface as P0-clean instead of
 * recording `white_screen` / `placeholder_end_state`.
 */
export function hasFachlicheSurface(
  body: string,
  signals: RegExp[],
  opts: { minMatches?: number; minBody?: number } = {},
): boolean {
  const { minMatches = 2, minBody = 80 } = opts;
  const trimmed = body.trim();
  if (trimmed.length < minBody) return false;
  const matches = signals.reduce((acc, re) => acc + (re.test(trimmed) ? 1 : 0), 0);
  return matches >= minMatches;
}
