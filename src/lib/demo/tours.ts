/**
 * Guided Tours — 5 Personas, je 3–5 Kernmomente.
 * Outcome-first, Risiko-first, KEINE technischen Erklärungen.
 */

export type TourPersona = "ausbildungsleiter" | "azubi" | "standortleiter" | "hr" | "executive";

export interface TourStep {
  title: string;
  outcome: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface GuidedTour {
  persona: TourPersona;
  label: string;
  promise: string;
  durationSeconds: number;
  steps: TourStep[];
}

export const GUIDED_TOURS: GuidedTour[] = [
  {
    persona: "ausbildungsleiter",
    label: "Ausbildungsleiter:in",
    promise: "Weniger Prüfungsausfälle, klare Interventionsprioritäten.",
    durationSeconds: 90,
    steps: [
      { title: "Risiko-Übersicht", outcome: "Sieh sofort, welche 6 Azubis durchfallen könnten.", ctaLabel: "Risiken zeigen", ctaHref: "/demo/cohort/fisi-fruehjahr-2026?view=risk" },
      { title: "Ursachen verstehen", outcome: "Konkrete Lernfeld-Schwächen statt Bauchgefühl.", ctaLabel: "Hotspots öffnen", ctaHref: "/demo/cohort/fisi-fruehjahr-2026?view=recovery" },
      { title: "Intervention vorschlagen", outcome: "Recovery-Set + Tutor-Session — vorgeschlagen, ein Klick.", ctaLabel: "Workflow starten", ctaHref: "/demo/cohort/fisi-fruehjahr-2026?view=intervention" },
      { title: "Wirkung messen", outcome: "Sieh Recovery-Lift nach 14 Tagen — pro Lernfeld.", ctaLabel: "Outcome ansehen", ctaHref: "/demo/cohort/fisi-fruehjahr-2026?view=exam_risk" },
    ],
  },
  {
    persona: "azubi",
    label: "Azubi",
    promise: "Klarer Lernpfad, weniger Frust, höhere Prüfungschance.",
    durationSeconds: 75,
    steps: [
      { title: "Dein Risiko-Status", outcome: "Sieh sofort, wo du stehst und was kritisch ist.", ctaLabel: "Status zeigen", ctaHref: "/demo/journey?stage=risk" },
      { title: "Was fehlt dir wirklich?", outcome: "Konkrete Kompetenzen statt vager Lernpläne.", ctaLabel: "Lücken zeigen", ctaHref: "/demo/journey?stage=cause" },
      { title: "Dein nächster Schritt", outcome: "Eine konkrete Aufgabe — sofort umsetzbar.", ctaLabel: "Aufgabe starten", ctaHref: "/demo/journey?stage=intervention" },
      { title: "Dein Fortschritt", outcome: "Sieh die Wirkung deiner letzten Lerneinheit.", ctaLabel: "Wirkung zeigen", ctaHref: "/demo/journey?stage=effect" },
    ],
  },
  {
    persona: "standortleiter",
    label: "Standortleiter:in",
    promise: "Standorte vergleichen, Risiken früh erkennen, Ressourcen lenken.",
    durationSeconds: 90,
    steps: [
      { title: "Standorte vergleichen", outcome: "Welcher Standort hat das höchste Prüfungsrisiko?", ctaLabel: "Vergleich öffnen", ctaHref: "/demo/cohort/fisi-fruehjahr-2026?view=compare" },
      { title: "Bottleneck identifizieren", outcome: "Welche Kompetenzen schwächeln standortübergreifend?", ctaLabel: "Hotspots zeigen", ctaHref: "/demo/cohort/bilanzbuchhalter-intensiv?view=recovery" },
      { title: "Maßnahme ableiten", outcome: "Recovery-Pfad für betroffene Cohorts vorgeschlagen.", ctaLabel: "Maßnahme zeigen", ctaHref: "/demo/cohort/bilanzbuchhalter-intensiv?view=intervention" },
    ],
  },
  {
    persona: "hr",
    label: "HR / People Development",
    promise: "Skill-Lücken sichtbar, Maßnahmen messbar, ROI nachweisbar.",
    durationSeconds: 80,
    steps: [
      { title: "Workforce-Risiko", outcome: "Welche Skills fehlen 12 Monaten vor der Prüfung?", ctaLabel: "Risiko zeigen", ctaHref: "/demo/cohort/industriekaufleute-ap2?view=risk" },
      { title: "Maßnahmen-Wirkung", outcome: "Welche Recovery-Sets liefern den höchsten Lift?", ctaLabel: "Wirkung zeigen", ctaHref: "/demo/cohort/industriekaufleute-ap2?view=recovery" },
      { title: "Executive Narrative", outcome: "3-Satz-Zusammenfassung für die Geschäftsleitung.", ctaLabel: "Narrative öffnen", ctaHref: "/demo/cohort/industriekaufleute-ap2?view=narrative" },
    ],
  },
  {
    persona: "executive",
    label: "Geschäftsleitung",
    promise: "Workforce-Intelligence in 60 Sekunden — Risiko, Wirkung, Forecast.",
    durationSeconds: 60,
    steps: [
      { title: "Top-Risiko-Kohorte", outcome: "Welche Kohorte gefährdet die nächste Prüfungswelle?", ctaLabel: "Kohorte zeigen", ctaHref: "/demo/cohort/bilanzbuchhalter-intensiv?view=risk" },
      { title: "Outcome-Forecast", outcome: "Wahrscheinliche Bestehensquote + Driver.", ctaLabel: "Forecast öffnen", ctaHref: "/demo/cohort/bilanzbuchhalter-intensiv?view=exam_risk" },
      { title: "Executive Narrative", outcome: "Eine Folie. Eine Aussage. Eine Entscheidung.", ctaLabel: "Narrative zeigen", ctaHref: "/demo/cohort/bilanzbuchhalter-intensiv?view=narrative" },
    ],
  },
];
