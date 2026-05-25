/**
 * W1 Cut 1 — ReadinessSignalBlock
 *
 * Generalized USP block that positions BerufOS as a "Prüfungsreife-System".
 * Three modes:
 *  - landing  : marketing surface (anonymous, illustrative numbers)
 *  - product  : product/pillar page (uses contextual labels)
 *  - learner  : signed-in dashboard header (callers pass real values)
 *
 * Never computes readiness — pure presentation. Real numbers come from the
 * Examiner Handover Contract via the caller.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, AlertTriangle, ArrowRight, Brain } from "lucide-react";

export type ReadinessMode = "landing" | "product" | "learner";

interface CompetencySignal {
  name: string;
  value: number;
}

interface Props {
  mode: ReadinessMode;
  /** Context label, e.g. beruf name or pruefung title. */
  contextLabel?: string;
  /** Readiness score 0-100. */
  score?: number;
  /** Top-3 competency mastery list. */
  competencies?: ReadonlyArray<CompetencySignal>;
  /** Headline of the "next action" card. */
  nextActionLabel?: string;
  /** Short body of the "next action" card. */
  nextActionBody?: string;
}

const DEFAULTS: Record<
  ReadinessMode,
  {
    eyebrow: string;
    heading: string;
    subhead: string;
    score: number;
    competencies: ReadonlyArray<CompetencySignal>;
    nextActionLabel: string;
    nextActionBody: string;
  }
> = {
  landing: {
    eyebrow: "Prüfungsreife messen",
    heading: "Nicht alle Themen sind gleich wichtig.",
    subhead:
      "BerufOS priorisiert die Themen, die deine Prüfungsreife am stärksten verbessern – statt jeden Rahmenplan-Punkt gleich zu gewichten.",
    score: 72,
    competencies: [
      { name: "Rechnungswesen", value: 84 },
      { name: "Warenwirtschaft", value: 58 },
      { name: "Kundenkommunikation", value: 41 },
    ],
    nextActionLabel: "Nächste Aktion",
    nextActionBody: "MiniCheck »Kundenkommunikation" – 8 Fragen, ~6 Min.",
  },
  product: {
    eyebrow: "Was du in diesem Kurs erreichst",
    heading: "Prüfungsreife statt Themenliste.",
    subhead:
      "Jeder Lernschritt zielt auf einen messbaren Prüfungsreife-Score – nicht auf vollständige Kursabsolvierung.",
    score: 68,
    competencies: [
      { name: "Pflichtkompetenzen", value: 78 },
      { name: "Risikothemen", value: 52 },
      { name: "Mündliche Muster", value: 45 },
    ],
    nextActionLabel: "Empfohlener Start",
    nextActionBody: "Readiness-Check (4 Min., ohne Anmeldung).",
  },
  learner: {
    eyebrow: "Dein Stand",
    heading: "Heute zählt: die richtigen 20 % lernen.",
    subhead: "Wir zeigen dir, welche Themen aktuell die meisten Punkte kosten.",
    score: 0,
    competencies: [],
    nextActionLabel: "Nächste Aktion",
    nextActionBody: "Adaptive Übung starten.",
  },
};

export function ReadinessSignalBlock(props: Props) {
  const defaults = DEFAULTS[props.mode];
  const score = props.score ?? defaults.score;
  const competencies = props.competencies ?? defaults.competencies;
  const nextActionLabel = props.nextActionLabel ?? defaults.nextActionLabel;
  const nextActionBody = props.nextActionBody ?? defaults.nextActionBody;

  return (
    <section className="container max-w-5xl py-10 md:py-14 space-y-6">
      <div className="max-w-2xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
          {defaults.eyebrow}
        </p>
        <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
          {defaults.heading}
        </h2>
        <p className="text-base text-text-secondary leading-relaxed">
          {props.contextLabel ? `Für ${props.contextLabel}: ` : ""}
          {defaults.subhead}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Prüfungsreife-Score
              </span>
              <Target className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold tabular-nums text-text-primary">{score}</span>
              <span className="text-sm text-text-tertiary mb-1">/ 100</span>
            </div>
            <Progress value={score} aria-label={`Prüfungsreife ${score} Prozent`} />
            <p className="text-xs text-text-tertiary">
              {props.mode === "learner"
                ? "Live aus deinen Übungen ermittelt."
                : "In ~4 Minuten ermittelt – ohne Anmeldung."}
            </p>
          </CardContent>
        </Card>

        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Kompetenz-Mastery
              </span>
              <Brain className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            {competencies.length > 0 ? (
              <ul className="space-y-3">
                {competencies.map((c) => (
                  <li key={c.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-secondary">{c.name}</span>
                      <span className="text-text-tertiary tabular-nums">{c.value}%</span>
                    </div>
                    <Progress value={c.value} aria-label={`${c.name} ${c.value} Prozent`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-tertiary">Starte eine Übung, um Werte zu sehen.</p>
            )}
          </CardContent>
        </Card>

        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Offene Schwächen
              </span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              Wir bauen deinen Lernplan automatisch um die Themen, die dich aktuell die meisten
              Punkte kosten.
            </p>
            <div className="flex items-center gap-2 text-sm font-medium text-petrol-600 dark:text-mint-400">
              {nextActionLabel}
              <ArrowRight className="h-4 w-4" />
            </div>
            <p className="text-sm text-text-primary">{nextActionBody}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
