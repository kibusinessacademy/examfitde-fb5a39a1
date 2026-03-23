import { CheckCircle, Brain, Mic, TrendingUp, Target } from 'lucide-react';

/**
 * ProductProof – replaces fake testimonials with honest,
 * verifiable product-level proof. No invented names or quotes.
 */

const BENEFITS = [
  {
    icon: Brain,
    title: 'Schwächen sichtbar machen',
    description: 'Das adaptive System erkennt nach wenigen Übungen, welche Themen noch unsicher sitzen – und trainiert genau dort weiter.',
  },
  {
    icon: Target,
    title: 'Prüfungsnah statt allgemein',
    description: 'Alle Aufgaben orientieren sich am offiziellen IHK-Rahmenplan. Kein Raten, kein Büffeln – gezieltes Prüfungstraining.',
  },
  {
    icon: Mic,
    title: 'Mündliche Prüfung üben',
    description: 'Das Fachgespräch simulieren, Antworten trainieren und Echtzeit-Feedback erhalten – bevor es zählt.',
  },
  {
    icon: TrendingUp,
    title: 'Fortschritt messen',
    description: 'Der Prüfungsreife-Indikator zeigt in Echtzeit, wie nah du am Bestehen bist – damit du weißt, wo du stehst.',
  },
];

const TYPICAL_EFFECTS = [
  'Klarer Überblick über eigene Wissenslücken nach dem ersten Training',
  'Spürbar mehr Sicherheit bei prüfungsnahen Aufgabentypen',
  'Strukturierte Vorbereitung statt planloses Lernen',
  'Weniger Prüfungsangst durch realistische Simulation',
];

export function Testimonials() {
  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3">
            Was du mit ExamFit <span className="text-gradient">konkret bekommst</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Kein Marketing-Versprechen – das sind die echten Funktionen, mit denen Azubis ihre Prüfung vorbereiten.
          </p>
        </div>

        {/* Product Benefits Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className="glass-card rounded-2xl p-5 flex flex-col gap-3 hover:border-primary/30 transition-colors"
            >
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-muted/50">
                <b.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold">{b.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>

        {/* Typical Effects – honest, no person claims */}
        <div className="glass-card rounded-2xl p-5 sm:p-6 max-w-2xl mx-auto">
          <h3 className="text-sm font-semibold mb-4 text-center">Häufige Effekte nach 2 Wochen Training</h3>
          <div className="grid gap-2.5">
            {TYPICAL_EFFECTS.map((effect) => (
              <div key={effect} className="flex items-start gap-2.5">
                <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">{effect}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
