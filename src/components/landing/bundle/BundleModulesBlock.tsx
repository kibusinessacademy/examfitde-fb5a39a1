import { Card, CardContent } from '@/components/ui/card';
import { BookOpen, ListChecks, FileQuestion, Bot, Mic, Gauge, type LucideIcon } from 'lucide-react';

type Mod = { icon: LucideIcon; title: string; copy: string };

const MODULES: Mod[] = [
  {
    icon: BookOpen,
    title: 'Lernkurs nach Rahmenplan',
    copy: 'Strukturierte Lektionen entlang des offiziellen Rahmenplans deines Berufs.',
  },
  {
    icon: ListChecks,
    title: 'MiniChecks',
    copy: 'Kurze Kompetenz-Checks nach jeder Lektion — sofortiges Feedback statt Stoffberg.',
  },
  {
    icon: FileQuestion,
    title: 'Schriftlicher Prüfungstrainer',
    copy: 'Echte Prüfungsfragen, ausführliche Lösungen, adaptive Wiederholung schwacher Themen.',
  },
  {
    icon: Bot,
    title: 'KI-Tutor mit Quellenlogik',
    copy: 'Antwortet ausschließlich aus deinem Rahmenplan — mit Quellenangabe in jedem Satz.',
  },
  {
    icon: Mic,
    title: 'Mündliche Prüfungssimulation',
    copy: 'Trainiere das Fachgespräch laut, mit strukturiertem Feedback zu Inhalt und Sprache.',
  },
  {
    icon: Gauge,
    title: 'Prüfungsreife-Score',
    copy: 'Misst kontinuierlich, wie sicher du in jedem Handlungsfeld stehst.',
  },
];

export function BundleModulesBlock() {
  return (
    <section className="py-12 md:py-16 bg-surface-sunken">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-2 text-text-primary">
            Sechs Module — ein Prüfungssystem
          </h2>
          <p className="text-sm md:text-base text-text-secondary max-w-xl mx-auto">
            Jedes Modul greift in das nächste. Du lernst, übst, trainierst und prüfst dich
            in einem geschlossenen Kreislauf.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(({ icon: Icon, title, copy }) => (
            <Card key={title} variant="raised" className="h-full">
              <CardContent className="p-5">
                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center mb-3">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-text-primary mb-1.5 leading-tight">{title}</h3>
                <p className="text-sm text-text-secondary leading-snug">{copy}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
