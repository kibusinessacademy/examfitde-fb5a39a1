/**
 * resolveDashboardNextStep — Deterministic Next-Step SSOT for /dashboard.
 * ──────────────────────────────────────────────────────────────────────
 * P0.3 root-cause fix (2026-06-05):
 *
 * The Customer Reality Gate flagged `dead_cta` / `no next-step cta` on
 * /dashboard because the next-step CTA was inlined as an IIFE inside
 * `LearnerDashboard.tsx`. The Dashboard would silently render passive
 * states when data was partial (loading, empty enrollments, missing
 * curriculum, finished course, no license) — no SSOT, no audit trail,
 * no unit-tested hierarchy.
 *
 * This module is the single source of truth for "what should the
 * learner do next?". It is:
 *
 *   • Pure   — no React, no Supabase, no I/O. Easy to unit-test.
 *   • Total  — every input combination returns a valid {kind,label,to}.
 *   • Stable — the `kind` discriminator is part of the public contract
 *              (Reality-Gate + analytics + future A/B tests assert on it).
 *   • Extensible — accepts optional signals (minicheck open, weakest
 *                  competency, license missing) without breaking older
 *                  callers. Add new fields, never repurpose existing
 *                  kinds.
 *
 * Hierarchy (first match wins — order is part of the contract):
 *
 *   1. open_minicheck       — MiniCheck explicitly open (signal)
 *   2. resume_course        — Enrollment in progress (course not done)
 *   3. continue_curriculum  — Enrollment finished but curriculum has more
 *   4. simulate_exam        — Enrollment finished + nothing else open
 *   5. weakest_competency   — Mastery signal points to a gap (signal)
 *   6. onboarding_minicheck — Curriculum exists, no enrollment yet
 *   7. choose_beruf         — No license / no curriculum at all
 *
 * Never returns null. Never returns an empty label or `to`. The Reality
 * Gate test asserts `aria-label="dashboard-next-step-cta"` always
 * renders and is non-empty.
 */

export type DashboardNextStepKind =
  | "open_minicheck"
  | "resume_course"
  | "continue_curriculum"
  | "simulate_exam"
  | "weakest_competency"
  | "onboarding_minicheck"
  | "choose_beruf";

export interface DashboardNextStep {
  /** Stable analytics + Reality-Gate discriminator. Do NOT repurpose. */
  kind: DashboardNextStepKind;
  /** User-facing button text (German, no emojis). */
  label: string;
  /** Internal route path. Always starts with `/`. */
  to: string;
  /** Short rationale shown next to the CTA. Always present. */
  rationale: string;
}

/**
 * Slim view of an enrollment — keep this decoupled from
 * `DashboardEnrollment` so the resolver doesn't drag the Supabase
 * type into pure code.
 */
export interface ResolverEnrollment {
  course_id: string;
  title: string | null;
  total_lessons: number;
  completed_lessons: number;
}

export interface ResolverInput {
  enrollments: ResolverEnrollment[];
  activeCurriculumId: string | null;
  /** Signal: MiniCheck-Session explizit offen / unterbrochen. */
  openMiniCheck?: { curriculumId: string; sessionId?: string } | null;
  /** Signal: schwächste Kompetenz (Mastery-Engine). */
  weakestCompetency?: { competencyId: string; label?: string } | null;
  /** Signal: Lizenz/Entitlement fehlt → Erwerbs-CTA statt Spinner. */
  licenseMissing?: boolean;
}

const ROUTE = {
  berufe: "/berufe",
  courses: "/courses",
  course: (id: string) => `/course/${id}`,
  miniCheck: (curriculumId?: string | null, sessionId?: string) => {
    if (sessionId) return `/minicheck/${sessionId}`;
    return curriculumId ? `/minicheck?curriculum=${curriculumId}` : "/minicheck";
  },
  examSimulation: (curriculumId?: string | null) =>
    curriculumId ? `/exam-simulation?curriculum=${curriculumId}` : "/exam-simulation",
  mastery: (competencyId: string) => `/mastery/${competencyId}`,
} as const;

function isCourseInProgress(e: ResolverEnrollment): boolean {
  if (!e.course_id) return false;
  if (e.total_lessons <= 0) return true; // started but no lesson telemetry yet
  return e.completed_lessons < e.total_lessons;
}

function isCourseFinished(e: ResolverEnrollment): boolean {
  return e.total_lessons > 0 && e.completed_lessons >= e.total_lessons;
}

/** Stable enrollment ordering: in-progress first, then most-recent course_id. */
function pickPrimary(enrollments: ResolverEnrollment[]): ResolverEnrollment | null {
  if (!enrollments.length) return null;
  const inProgress = enrollments.find(isCourseInProgress);
  if (inProgress) return inProgress;
  return enrollments[0] || null;
}

/**
 * Deterministic resolver. Pure. Total. Order matters.
 */
export function resolveDashboardNextStep(input: ResolverInput): DashboardNextStep {
  const {
    enrollments,
    activeCurriculumId,
    openMiniCheck,
    weakestCompetency,
    licenseMissing,
  } = input;

  // 0. Hard guard: no license + no curriculum → must surface acquisition CTA.
  //    `licenseMissing` only applies when there is also nothing to fall back to;
  //    otherwise the in-progress course still wins (the learner already paid).
  if (licenseMissing && !enrollments.length && !activeCurriculumId) {
    return {
      kind: "choose_beruf",
      label: "Beruf wählen & starten",
      to: ROUTE.berufe,
      rationale: "Wähle deinen Prüfungsberuf, um deinen Lernplan zu erhalten.",
    };
  }

  // 1. MiniCheck explicitly open → resume it (deepest engagement signal).
  if (openMiniCheck && (openMiniCheck.curriculumId || openMiniCheck.sessionId)) {
    return {
      kind: "open_minicheck",
      label: "MiniCheck fortsetzen",
      to: ROUTE.miniCheck(openMiniCheck.curriculumId, openMiniCheck.sessionId),
      rationale: "Du hast einen MiniCheck offen — schließe ihn jetzt ab.",
    };
  }

  // 2. Course in progress → resume.
  const primary = pickPrimary(enrollments);
  if (primary && isCourseInProgress(primary)) {
    const title = primary.title?.trim();
    return {
      kind: "resume_course",
      label: "Weiter lernen",
      to: ROUTE.course(primary.course_id),
      rationale: title ? `Weiter mit: ${title}` : "Setze deinen aktuellen Kurs fort.",
    };
  }

  // 3. Course finished but a curriculum is active → continue curriculum.
  if (primary && isCourseFinished(primary) && activeCurriculumId) {
    return {
      kind: "continue_curriculum",
      label: "Nächste Lerneinheit starten",
      to: ROUTE.courses,
      rationale: "Du hast den Kurs abgeschlossen — wähle deine nächste Lerneinheit.",
    };
  }

  // 4. Course finished, nothing else open → simulate the exam.
  if (primary && isCourseFinished(primary)) {
    return {
      kind: "simulate_exam",
      label: "Prüfung simulieren",
      to: ROUTE.examSimulation(activeCurriculumId),
      rationale: "Teste deine Prüfungsreife in einer realistischen Simulation.",
    };
  }

  // 5. Mastery gap signalled → train weakest competency.
  if (weakestCompetency?.competencyId) {
    const label = weakestCompetency.label?.trim();
    return {
      kind: "weakest_competency",
      label: label ? `${label} trainieren` : "Schwächste Kompetenz trainieren",
      to: ROUTE.mastery(weakestCompetency.competencyId),
      rationale: "Schließe deine größte Wissenslücke gezielt.",
    };
  }

  // 6. Curriculum chosen but no enrollment yet → onboarding via MiniCheck.
  if (activeCurriculumId) {
    return {
      kind: "onboarding_minicheck",
      label: "MiniCheck starten",
      to: ROUTE.miniCheck(activeCurriculumId),
      rationale: "Starte mit dem Selbsttest, damit wir deinen Lernplan kalibrieren.",
    };
  }

  // 7. Cold-empty state — always end here, never with a spinner / dead screen.
  return {
    kind: "choose_beruf",
    label: "Beruf wählen & starten",
    to: ROUTE.berufe,
    rationale: "Wähle deinen Prüfungsberuf, um deinen Lernplan zu erhalten.",
  };
}
