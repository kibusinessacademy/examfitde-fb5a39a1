import { Target, Brain, Mic, GraduationCap, BookOpen, BarChart3, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ProductPageSSOT, ProductModuleItem } from '@/types/product-page';

const ICON_MAP: Record<string, React.ElementType> = {
  simulation: Target,
  oral: Mic,
  tutor: Brain,
  score: BarChart3,
  analysis: GraduationCap,
  handbook: BookOpen,
};

function getIcon(key: string): React.ElementType {
  return ICON_MAP[key] || Zap;
}

/** Default modules when DB has none */
const DEFAULT_MODULES: ProductModuleItem[] = [
  { key: 'simulation', title: 'Schriftliche Prüfung simulieren', copy: 'Echte IHK-nahe Aufgaben mit Zeitdruck & Bewertung' },
  { key: 'oral', title: 'Mündliche Prüfung trainieren', copy: 'KI stellt typische Prüfungsfragen mit Feedback' },
  { key: 'tutor', title: 'KI-Prüfungscoach', copy: 'Erklärt Schwächen und zeigt Prüfungsfallen' },
  { key: 'score', title: 'Prüfungsreife-Score', copy: 'Objektive Einschätzung deiner Bestehenschance' },
  { key: 'analysis', title: 'Adaptive Schwächenanalyse', copy: 'Erkennt Lücken und trainiert gezielt' },
  { key: 'handbook', title: 'Prüfungswissen kompakt', copy: 'Handbuch pro Lernfeld – nur prüfungsrelevant' },
];

interface Props {
  product: ProductPageSSOT;
}

export function ProductModulesBlock({ product }: Props) {
  const caps = product.capabilities;
  let modules = product.modules.length > 0 ? product.modules : DEFAULT_MODULES;

  // Filter by capabilities
  modules = modules.filter((m) => {
    if (m.key === 'oral' && !caps.oralModeAvailable) return false;
    if (m.key === 'handbook' && !caps.handbookAvailable) return false;
    return true;
  });

  if (modules.length === 0) return null;

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">System-Module</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">
            Alles, was du für die Prüfung brauchst
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => {
            const Icon = getIcon(mod.key);
            return (
              <Card key={mod.key} className="glass-card hover:shadow-lg transition-shadow">
                <CardContent className="p-5">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-base mb-2">{mod.title}</h3>
                  <p className="text-sm text-muted-foreground">{mod.copy}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
