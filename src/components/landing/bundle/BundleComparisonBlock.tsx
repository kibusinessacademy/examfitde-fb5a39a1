import { Card } from '@/components/ui/card';
import { X, Check } from 'lucide-react';

const LEFT = [
  'Viele Materialien zusammensuchen',
  'Keine klare Priorität',
  'Keine Prüfungssimulation',
  'Mündliche Prüfung „irgendwie" üben',
  'Unsicherheit vor der Prüfung',
];

const RIGHT = [
  'Schwächenanalyse mit Prüfungsreife-Score',
  'Lernplan nach Rahmenplan',
  'Echte Prüfungsfragen + adaptive Wiederholung',
  'Mündliche Simulation mit Bewertung',
  'Messbarer Fortschritt bis zur Prüfung',
];

export function BundleComparisonBlock() {
  return (
    <section className="py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-2 text-text-primary">
            Planlos lernen vs. Mit ExamFit trainieren
          </h2>
          <p className="text-sm md:text-base text-text-secondary">
            Warum ein System schneller zur Prüfungsreife führt als ein Stapel PDFs.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card variant="flat" className="p-5 border-border-subtle">
            <h3 className="font-semibold text-text-secondary mb-4">Planlos lernen</h3>
            <ul className="space-y-3">
              {LEFT.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <span className="text-sm text-text-secondary leading-snug">{t}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="raised" className="p-5 border-primary/30">
            <h3 className="font-semibold text-primary mb-4">Mit ExamFit trainieren</h3>
            <ul className="space-y-3">
              {RIGHT.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span className="text-sm text-text-primary leading-snug">{t}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
