import { ReadinessScoreDemo } from "./ReadinessScoreDemo";
import { CompetencyMasteryDemo } from "./CompetencyMasteryDemo";
import { ExamQuestionDemo } from "./ExamQuestionDemo";
import { AiTutorDemo } from "./AiTutorDemo";
import { OralExamDemo } from "./OralExamDemo";

/**
 * Phase E — Interaktive Produkt-Mockups.
 * Ersetzt die statische ProductPreviewGallery. Demos sind frontend-only,
 * nutzen kein Backend, schreiben keine SSOT-Daten und feuern keine neuen
 * Tracking-Events (nur bestehende `cta_click`).
 */
export function DemoGallery() {
  return (
    <section className="py-12 sm:py-20 bg-background">
      <div className="container px-4 mx-auto max-w-6xl">
        <header className="text-center mb-10 sm:mb-14 max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            Live ausprobieren
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
            So fühlt sich ExamFit an.
          </h2>
          <p className="text-base text-text-secondary">
            Klick dich in 30 Sekunden durch die fünf Kernmodule — vom Score über die
            Schwächen­analyse bis zur mündlichen Simulation.
          </p>
        </header>

        <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
          <ReadinessScoreDemo />
          <CompetencyMasteryDemo />
          <ExamQuestionDemo />
          <AiTutorDemo />
          <div className="md:col-span-2">
            <OralExamDemo />
          </div>
        </div>

        <p className="text-center text-xs text-text-tertiary mt-8">
          Beispieldaten zu Demonstrationszwecken — echte Inhalte richten sich nach deinem Beruf.
        </p>
      </div>
    </section>
  );
}
