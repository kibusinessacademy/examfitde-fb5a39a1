import { Card, CardContent } from '@/components/ui/card';
import { BookOpen, ListChecks, FileCheck, Brain, Mic, BookMarked } from 'lucide-react';

interface Props {
  beruf: string;
  kammer: string;
}

interface Module {
  icon: typeof BookOpen;
  title: string;
  what: string;
  why: (beruf: string, kammer: string) => string;
  outcome: string;
}

const MODULES: Module[] = [
  {
    icon: BookOpen,
    title: 'Lernkurs nach Rahmenplan',
    what: 'Strukturiertes Lernmaterial, gegliedert nach offiziellem Rahmenplan.',
    why: (b, k) => `Deckt jeden prüfungsrelevanten Bereich der ${k}-Prüfung ${b} ab – ohne Lücken.`,
    outcome: 'Du weißt, was du gelernt hast und was noch offen ist.',
  },
  {
    icon: ListChecks,
    title: 'MiniChecks',
    what: 'Kurze Wissens-Checks pro Kompetenzbereich (5–10 Fragen).',
    why: () => 'Macht in wenigen Minuten sichtbar, wo du sicher bist und wo nicht.',
    outcome: 'Klare Schwächenanalyse statt Bauchgefühl.',
  },
  {
    icon: FileCheck,
    title: 'Schriftlicher Prüfungstrainer',
    what: 'Prüfungsnahe Aufgaben mit Bewertung und Lösungsweg.',
    why: (b, k) => `Trainiert genau die Frageformate der ${k}-Abschlussprüfung ${b}.`,
    outcome: 'Du gehst in die Prüfung mit echter Aufgabenroutine.',
  },
  {
    icon: Brain,
    title: 'KI-Tutor mit Quellen',
    what: 'Stellt Rückfragen, erklärt Konzepte, zeigt Quellen aus dem Kurs.',
    why: () => 'Beantwortet deine konkrete Frage – nicht irgendeine generische.',
    outcome: 'Verstehen statt auswendig lernen.',
  },
  {
    icon: Mic,
    title: 'Mündliche Prüfungssimulation',
    what: 'Realistisches Fachgespräch mit strukturierter Bewertung.',
    why: (b) => `Simuliert das Fachgespräch der ${b}-Prüfung – inkl. Begriffssicherheit und Praxisbezug.`,
    outcome: 'Du weißt vorher, wie du im Prüfungsgespräch klingst.',
  },
  {
    icon: BookMarked,
    title: 'Prüfungshandbuch',
    what: 'Kompakte Referenz mit Begriffen, Formeln und Prüfungsregeln.',
    why: () => 'Schnelles Nachschlagen statt langer Skript-Suche.',
    outcome: 'Sicherheit in der Prüfungssituation.',
  },
];

export function BerufModulesBlock({ beruf, kammer }: Props) {
  return (
    <section className="border-t border-border-subtle bg-surface-sunken">
      <div className="container max-w-6xl py-12 md:py-16 space-y-8">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
            Module für die {beruf}-Prüfung
          </p>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
            Sechs Module, die zusammen ein Prüfungssystem ergeben.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((m) => (
            <Card key={m.title} variant="raised">
              <CardContent className="py-5 px-5 space-y-3">
                <div className="w-9 h-9 rounded-lg bg-mint-50 dark:bg-petrol-900/40 flex items-center justify-center">
                  <m.icon className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
                </div>
                <h3 className="font-semibold text-text-primary">{m.title}</h3>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-text-tertiary">Was</dt>
                    <dd className="text-text-secondary">{m.what}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-text-tertiary">Warum hier</dt>
                    <dd className="text-text-secondary">{m.why(beruf, kammer)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-text-tertiary">Ergebnis</dt>
                    <dd className="text-text-primary font-medium">{m.outcome}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
