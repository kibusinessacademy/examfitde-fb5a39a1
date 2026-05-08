import { Card, CardContent } from '@/components/ui/card';
import { Target, ListChecks, Mic, TrendingUp, type LucideIcon } from 'lucide-react';

const OUTCOMES: { icon: LucideIcon; title: string; copy: string }[] = [
  {
    icon: Target,
    title: 'Du weißt, wo du stehst.',
    copy: 'Der Prüfungsreife-Score zeigt pro Handlungsfeld, wie sicher du bist.',
  },
  {
    icon: ListChecks,
    title: 'Du lernst zuerst, was Punkte kostet.',
    copy: 'Die Schwächenanalyse priorisiert Themen nach Prüfungsrelevanz.',
  },
  {
    icon: Mic,
    title: 'Du trainierst schriftlich und mündlich.',
    copy: 'Echte Aufgaben + Fachgespräch-Simulation mit strukturierter Bewertung.',
  },
  {
    icon: TrendingUp,
    title: 'Du gehst strukturierter in die Prüfung.',
    copy: 'Klarer Lernplan, sichtbarer Fortschritt — kein Bauchgefühl, sondern Daten.',
  },
];

export function BundleOutcomesBlock() {
  return (
    <section className="py-12 md:py-16 bg-surface-sunken">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-2 text-text-primary">
            Was du nach der Vorbereitung kannst
          </h2>
          <p className="text-sm md:text-base text-text-secondary">
            Vier konkrete Ergebnisse — keine Marketingversprechen.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {OUTCOMES.map(({ icon: Icon, title, copy }) => (
            <Card key={title} variant="raised">
              <CardContent className="p-5 flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary mb-1 leading-tight">{title}</h3>
                  <p className="text-sm text-text-secondary leading-snug">{copy}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
