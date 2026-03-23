import { Star } from 'lucide-react';

interface Testimonial {
  name: string;
  role: string;
  beruf: string;
  quote: string;
  stars: number;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Laura M.',
    role: 'Auszubildende',
    beruf: 'Kauffrau für Büromanagement',
    quote: 'Ich hatte richtig Angst vor der Abschlussprüfung. Mit ExamFit habe ich genau gewusst, wo ich stehe – und mit 82 Punkten bestanden!',
    stars: 5,
  },
  {
    name: 'Tobias K.',
    role: 'Auszubildender',
    beruf: 'Fachinformatiker Anwendungsentwicklung',
    quote: 'Die mündliche Prüfungssimulation war Gold wert. Im echten Fachgespräch hatte ich kein einziges Blackout mehr.',
    stars: 5,
  },
  {
    name: 'Sandra H.',
    role: 'Ausbildungsleiterin',
    beruf: 'Mittelständischer Betrieb, 12 Azubis',
    quote: 'Seit wir ExamFit einsetzen, hat kein einziger Azubi mehr die Prüfung nicht bestanden. Der Prüfungsreife-Indikator gibt uns echte Planungssicherheit.',
    stars: 5,
  },
  {
    name: 'Mehmet A.',
    role: 'Auszubildender',
    beruf: 'Industriekaufmann',
    quote: 'Die adaptiven Übungen haben mir gezeigt, welche Themen ich wirklich nicht konnte. 3 Wochen gezieltes Training und die Prüfung war kein Problem.',
    stars: 5,
  },
];

export function Testimonials() {
  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-3">
            Das sagen unsere <span className="text-gradient">Absolventen</span>
          </h2>
          <p className="text-muted-foreground">
            Über 5.000 Auszubildende haben mit ExamFit ihre Prüfung bestanden.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.name}
              className="glass-card rounded-2xl p-5 flex flex-col gap-3 hover:border-primary/30 transition-colors"
            >
              <div className="flex gap-0.5">
                {Array.from({ length: t.stars }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 text-warning fill-warning" />
                ))}
              </div>
              <p className="text-sm text-foreground leading-relaxed flex-1">
                „{t.quote}"
              </p>
              <div className="pt-2 border-t border-border">
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role} · {t.beruf}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
