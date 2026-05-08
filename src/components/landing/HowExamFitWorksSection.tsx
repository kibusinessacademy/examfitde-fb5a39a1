/**
 * "So funktioniert ExamFit" – 4-Schritte Prozess (Phase A).
 *
 * Phase A Positionierung: Prüfungssystem statt Lernplattform.
 * Schritte: Testen → Schwächen erkennen → Trainieren → Simulieren.
 */
import { ClipboardCheck, Target, BookOpen, Mic } from "lucide-react";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "Prüfungsreife testen",
    text: "Beantworte kurze Einstiegsfragen und erkenne sofort, wo du stehst.",
  },
  {
    icon: Target,
    title: "Schwächen erkennen",
    text: "ExamFit ordnet deine Ergebnisse Kompetenzen und Prüfungsthemen zu.",
  },
  {
    icon: BookOpen,
    title: "Gezielt trainieren",
    text: "Du lernst mit Kursen, MiniChecks, Prüfungsfragen und KI-Tutor.",
  },
  {
    icon: Mic,
    title: "Prüfung simulieren",
    text: "Trainiere schriftlich und mündlich mit Zeitlimit, Bewertung und Feedback.",
  },
];

export function HowExamFitWorksSection() {
  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-8 md:mb-12 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3 leading-tight">
            So funktioniert <span className="text-gradient">ExamFit</span>
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-snug">
            Vier Schritte vom kostenlosen Selbsttest bis zur prüfungssicheren Vorbereitung —
            schriftlich und mündlich.
          </p>
        </div>

        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 list-none">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li
              key={title}
              className="rounded-2xl glass-card p-5 sm:p-6 relative hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <span className="text-xs font-mono text-muted-foreground tabular-nums">
                  Schritt {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="font-display font-semibold text-base sm:text-lg mb-1.5 text-foreground leading-snug">
                {title}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                {text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
