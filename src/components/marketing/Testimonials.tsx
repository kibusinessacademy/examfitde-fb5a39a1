import { Eye, Target, Dumbbell, ArrowUpRight } from 'lucide-react';

/**
 * ProductProof – verifiable product-level proof only.
 * No invented names, quotes, or unverifiable claims.
 */

const BENEFITS = [
  {
    icon: Eye,
    title: 'Erkennen',
    description: 'Finde heraus, welche Themen und Aufgabenarten dir noch schwerfallen.',
  },
  {
    icon: Dumbbell,
    title: 'Trainieren',
    description: 'Übe gezielt mit prüfungsnahen Aufgaben und Simulationen.',
  },
  {
    icon: ArrowUpRight,
    title: 'Sicherer werden',
    description: 'Gehe strukturierter und mit mehr Klarheit in deine Abschlussprüfung.',
  },
];

const PRODUCT_FACTS = [
  'Trainiere mit prüfungsnahen Aufgaben statt mit allgemeiner Theorie',
  'Erkenne gezielt, wo du noch Lücken hast',
  'Übe schriftliche und mündliche Prüfungssituationen',
  'Arbeite fokussiert auf deine Abschlussprüfung hin',
];

export function Testimonials() {
  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3">
            Was dich mit ExamFit <span className="text-gradient">wirklich weiterbringt</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Kein Marketing-Versprechen – das sind die echten Funktionen, mit denen du deine Prüfung vorbereitest.
          </p>
        </div>

        {/* 3 benefit cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className="glass-card rounded-2xl p-6 flex flex-col gap-3 hover:border-primary/30 transition-colors text-center"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mx-auto">
                <b.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-semibold">{b.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>

        {/* Product facts */}
        <div className="glass-card rounded-2xl p-5 sm:p-6 max-w-2xl mx-auto">
          <h3 className="text-sm font-semibold mb-4 text-center">So nutzen Azubis ExamFit</h3>
          <div className="grid gap-2.5">
            {PRODUCT_FACTS.map((fact) => (
              <div key={fact} className="flex items-start gap-2.5">
                <Target className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">{fact}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
