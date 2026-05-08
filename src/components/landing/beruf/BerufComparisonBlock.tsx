import { Card, CardContent } from '@/components/ui/card';
import { Check, X } from 'lucide-react';

const NORMAL = [
  'Viele Unterlagen, keine Priorisierung',
  'Kein Bild von echter Prüfungsreife',
  'Keine echte Prüfungssimulation',
  'Keine mündliche Auswertung',
  'Kein Fortschrittsbild über die Zeit',
];

const EXAMFIT = [
  'Prüfungsreife-Score statt Bauchgefühl',
  'Kompetenz-Mastery pro Themenbereich',
  'Lernplan, der sich an deine Lücken anpasst',
  'Schriftliche Prüfungssimulation mit Bewertung',
  'Mündliches Feedback mit 4 Bewertungsachsen',
  'KI-Tutor mit Quellen aus dem Kurs',
];

export function BerufComparisonBlock() {
  return (
    <section className="border-t border-border-subtle bg-surface-sunken">
      <div className="container max-w-5xl py-12 md:py-16 space-y-8">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
            Vergleich
          </p>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
            Normale Vorbereitung vs. ExamFit-Prüfungssystem
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card variant="sunken">
            <CardContent className="py-6 px-5 space-y-3">
              <h3 className="font-semibold text-text-primary">Normale Vorbereitung</h3>
              <ul className="space-y-2 text-sm">
                {NORMAL.map((p) => (
                  <li key={p} className="flex gap-2 text-text-secondary">
                    <X className="h-4 w-4 text-text-tertiary mt-0.5 flex-shrink-0" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card variant="raised" className="border-petrol-200 dark:border-petrol-700">
            <CardContent className="py-6 px-5 space-y-3">
              <h3 className="font-semibold text-petrol-700 dark:text-mint-300">
                ExamFit-Prüfungssystem
              </h3>
              <ul className="space-y-2 text-sm">
                {EXAMFIT.map((p) => (
                  <li key={p} className="flex gap-2 text-text-primary">
                    <Check
                      className="h-4 w-4 text-petrol-600 dark:text-mint-400 mt-0.5 flex-shrink-0"
                      aria-hidden
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
