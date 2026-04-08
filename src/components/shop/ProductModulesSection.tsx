import { Target, Brain, Mic, GraduationCap, BookOpen, Shield, BarChart3, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { CurriculumProductStats } from '@/hooks/useCurriculumProductStats';

interface Props {
  stats: CurriculumProductStats;
}

export function ProductUSPBanner() {
  return (
    <section className="py-12 md:py-16 text-center">
      <div className="max-w-3xl mx-auto px-4">
        <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-3">Die Lösung</p>
        <h2 className="text-2xl md:text-4xl font-display font-bold mb-4">
          ExamFit ist kein Kurs.
        </h2>
        <p className="text-xl md:text-2xl text-muted-foreground">
          Es ist ein <strong className="text-foreground">intelligentes Prüfungstrainings-System</strong>.
          <br className="hidden sm:block" />
          Du trainierst nicht Inhalte – <span className="text-primary font-semibold">du trainierst die Prüfung.</span>
        </p>
      </div>
    </section>
  );
}

const MODULES = [
  {
    icon: Target,
    title: 'Schriftliche Prüfung simulieren',
    features: ['Echte IHK-nahe Aufgaben', 'Zeitdruck & Bewertung', 'Sofortiges Feedback'],
  },
  {
    icon: Mic,
    title: 'Mündliche Prüfung trainieren',
    features: ['KI stellt typische Prüfungsfragen', 'Bewertung wie ein Prüfer', 'Strukturiertes Feedback'],
    requiresOral: true,
  },
  {
    icon: Brain,
    title: 'KI-Prüfungscoach',
    features: ['Erklärt deine Schwächen', 'Zeigt typische Prüfungsfallen', 'Gibt dir Lernstrategie'],
  },
  {
    icon: BarChart3,
    title: 'Prüfungsreife-Score',
    features: ['Objektive Einschätzung', '„Bestehst du oder nicht?"', 'Fortschritts-Tracking'],
  },
  {
    icon: GraduationCap,
    title: 'Adaptive Schwächenanalyse',
    features: ['Erkennt deine Lücken', 'Trainiert gezielt', 'Spart dir Zeit'],
  },
  {
    icon: BookOpen,
    title: 'Prüfungswissen kompakt',
    features: ['Handbuch pro Lernfeld', 'Nur prüfungsrelevantes Wissen', 'Jederzeit nachschlagen'],
    requiresHandbook: true,
  },
];

export function ProductModulesSection({ stats }: Props) {
  const visibleModules = MODULES.filter(m => {
    if (m.requiresOral && !stats.has_oral_exam) return false;
    if (m.requiresHandbook && !stats.has_handbook) return false;
    return true;
  });

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">System-Module</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">
            Alles, was du für die Prüfung brauchst
          </h2>
          <p className="text-muted-foreground mt-2">
            {stats.question_count.toLocaleString('de-DE')}+ Prüfungsfragen · {stats.lf_count} Lernfelder · {stats.competency_count} Kompetenzen
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleModules.map((mod) => (
            <Card key={mod.title} className="glass-card hover:shadow-lg transition-shadow">
              <CardContent className="p-5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <mod.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-base mb-2">{mod.title}</h3>
                <ul className="space-y-1.5">
                  {mod.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Zap className="h-3 w-3 text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
