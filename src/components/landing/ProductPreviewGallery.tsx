/**
 * Produkt-Mockup-Galerie für die Startseite (Phase A).
 *
 * Ziel: ExamFit nicht als generische Lernplattform, sondern als
 * messbares Prüfungssystem zeigen — direkter Blick auf die UI-Mechanik.
 *
 * Statische Demo-Komponenten (kein DB-Touch). Designsystem-Tokens v2,
 * Petrol/Mint-Identität, dunkler Premium-Look.
 */
import { CheckCircle2, XCircle, Mic, Quote } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────── */
/* 1) Readiness-Score                                                   */
/* ──────────────────────────────────────────────────────────────────── */
function ReadinessScoreMock() {
  const score = 72;
  const circumference = 2 * Math.PI * 38;
  const dash = (score / 100) * circumference;
  return (
    <div className="rounded-2xl glass-card p-5 flex items-center gap-4">
      <div className="relative w-24 h-24 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="38" className="fill-none stroke-muted" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r="38"
            className="fill-none stroke-primary transition-all"
            strokeWidth="9"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-display font-bold text-foreground">{score}%</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Reife</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground mb-1">Prüfungsreife-Score</div>
        <div className="text-sm font-medium text-foreground leading-snug">
          Du bist auf gutem Weg — 4 Themen brauchen noch Fokus.
        </div>
        <div className="text-[11px] text-success mt-1">+8 % seit letzter Woche</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* 2) Kompetenz-Mastery                                                 */
/* ──────────────────────────────────────────────────────────────────── */
const COMPETENCIES = [
  { name: "Kundenkommunikation", level: 92, label: "mastered" as const },
  { name: "Warenwirtschaft", level: 58, label: "partial" as const },
  { name: "Rechnungswesen", level: 34, label: "fokus" as const },
];
function CompetencyMasteryMock() {
  return (
    <div className="rounded-2xl glass-card p-5">
      <div className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">
        Kompetenz-Mastery
      </div>
      <div className="space-y-3">
        {COMPETENCIES.map((c) => (
          <div key={c.name}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-medium text-foreground">{c.name}</span>
              <span
                className={
                  c.label === "mastered"
                    ? "text-[10px] text-success font-medium uppercase"
                    : c.label === "partial"
                      ? "text-[10px] text-warning font-medium uppercase"
                      : "text-[10px] text-destructive font-medium uppercase"
                }
              >
                {c.label}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={
                  c.label === "mastered"
                    ? "h-full bg-success transition-all"
                    : c.label === "partial"
                      ? "h-full bg-warning transition-all"
                      : "h-full bg-destructive transition-all"
                }
                style={{ width: `${c.level}%` }}
                aria-label={`${c.name}: ${c.level}%`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* 3) Prüfungsfrage                                                     */
/* ──────────────────────────────────────────────────────────────────── */
function ExamQuestionMock() {
  const options = [
    { key: "A", text: "Skontoabzug bei Zahlung innerhalb 10 Tagen", correct: true },
    { key: "B", text: "Mengenrabatt bei Großbestellung", correct: false },
    { key: "C", text: "Preisnachlass wegen Mängeln", correct: false },
  ];
  return (
    <div className="rounded-2xl glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Aufgabe · Rechnungswesen
        </span>
        <span className="text-[10px] text-primary font-medium">2 / 25</span>
      </div>
      <div className="text-sm font-medium text-foreground mb-4 leading-snug">
        Was beschreibt der Begriff „Skonto" korrekt?
      </div>
      <div className="space-y-2">
        {options.map((o) => (
          <div
            key={o.key}
            className={
              o.correct
                ? "flex items-start gap-2 rounded-lg border border-success/40 bg-success-bg-subtle px-3 py-2"
                : "flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2"
            }
          >
            {o.correct ? (
              <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
            )}
            <span className="text-xs text-foreground leading-snug">
              <span className="font-mono text-muted-foreground mr-1">{o.key}.</span>
              {o.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* 4) AI-Tutor Feedback (Strict-RAG Citation)                           */
/* ──────────────────────────────────────────────────────────────────── */
function AiTutorFeedbackMock() {
  return (
    <div className="rounded-2xl glass-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
          <Quote className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-xs font-medium text-foreground">KI-Tutor · mit Quellen</span>
      </div>
      <p className="text-sm text-foreground leading-snug mb-3">
        Skonto ist ein Preisnachlass für vorzeitige Zahlung — typische Frist 10 Tage,
        Abzug 2 %. Die Anschaffungskosten werden um den Skontobetrag gemindert.
      </p>
      <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
          Quelle
        </div>
        <div className="text-[11px] font-mono text-primary">
          § 255 HGB · Lehrplan 4.2 · MiniCheck #112
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* 5) Oral-Exam Feedback                                                */
/* ──────────────────────────────────────────────────────────────────── */
const ORAL_AXES = [
  { name: "Fachlichkeit", value: 4 },
  { name: "Struktur", value: 5 },
  { name: "Begriffssicherheit", value: 3 },
  { name: "Praxisbezug", value: 4 },
];
function OralExamFeedbackMock() {
  return (
    <div className="rounded-2xl glass-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center">
          <Mic className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-foreground">
          Mündliche Simulation · Auswertung
        </span>
      </div>
      <div className="space-y-2">
        {ORAL_AXES.map((a) => (
          <div key={a.name} className="flex items-center justify-between gap-3">
            <span className="text-xs text-foreground">{a.name}</span>
            <div className="flex gap-1" aria-label={`${a.name}: ${a.value} von 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={
                    i <= a.value
                      ? "h-1.5 w-5 rounded-full bg-primary"
                      : "h-1.5 w-5 rounded-full bg-muted"
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground leading-snug">
        Tipp: Nutze konkrete Praxisbeispiele zur Beleg-Stützung — das stärkt deinen Praxisbezug.
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Public Galerie                                                       */
/* ──────────────────────────────────────────────────────────────────── */
export function ProductPreviewGallery() {
  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-8 md:mb-10 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3 leading-tight">
            So sieht <span className="text-gradient">Prüfungsreife</span> aus
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-snug">
            Echte Bausteine aus dem System — Score, Mastery, Aufgabentraining, KI-Quellen
            und mündliche Auswertung. Keine Marketing-Cards, sondern das Produkt selbst.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          <ReadinessScoreMock />
          <CompetencyMasteryMock />
          <ExamQuestionMock />
          <AiTutorFeedbackMock />
          <div className="md:col-span-2">
            <OralExamFeedbackMock />
          </div>
        </div>
      </div>
    </section>
  );
}
