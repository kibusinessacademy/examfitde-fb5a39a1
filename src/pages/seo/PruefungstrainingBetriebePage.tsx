import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import {
  ArrowRight,
  CheckCircle,
  BarChart3,
  TrendingDown,
  AlertTriangle,
  ShieldCheck,
  Users,
  Target,
} from 'lucide-react';

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Prüfung hinzuarbeiten.' },
  { question: 'Ersetzt ExamFit die betriebliche Ausbildung?', answer: 'Nein. ExamFit ersetzt keine betriebliche Ausbildung. Es ergänzt sie dort, wo es am kritischsten wird: bei der konkreten Vorbereitung auf die Prüfung.' },
  { question: 'Für wen ist ExamFit geeignet?', answer: 'ExamFit eignet sich für Auszubildende, Studierende, Teilnehmende in Fort- und Weiterbildungen sowie Personen, die sich auf Zertifizierungsprüfungen vorbereiten.' },
];

export default function PruefungstrainingBetriebePage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining für Ausbildungsbetriebe | Prüfungsreife transparent machen')}
        description="Unterstütze Auszubildende gezielt bei der Prüfungsvorbereitung: mit transparentem Leistungsstand, prüfungsnahen Simulationen und messbarer Prüfungsreife."
        canonical={`${SITE_URL}/pruefungstraining-betriebe`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 sm:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Prüfungsreife sichtbar machen.{' '}
              <span className="text-gradient text-glow">Bestehensquoten gezielt verbessern.</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              ExamFit unterstützt Ausbildungsbetriebe mit einem intelligenten Prüfungstrainings-System für eine strukturierte, prüfungsnahe und messbare Vorbereitung ihrer Auszubildenden.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Lösungen für Betriebe ansehen
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/unternehmen">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Mehr erfahren
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Kernargumente */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              Warum Betriebe auf ExamFit <span className="text-gradient">setzen</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { icon: BarChart3, title: 'Früher erkennen, wer Unterstützung braucht', text: 'Transparenter Kompetenzstand je Auszubildendem – objektiv statt Bauchgefühl.' },
                { icon: ShieldCheck, title: 'Prüfungsvorbereitung standardisieren', text: 'Einheitliche, prüfungsnahe Vorbereitung für alle Auszubildenden.' },
                { icon: TrendingDown, title: 'Objektiver statt subjektiv bewerten', text: 'Messbare Daten zu Kompetenzständen statt rein subjektiver Einschätzung.' },
                { icon: Users, title: 'Selbstständig trainieren lassen', text: 'Auszubildende trainieren eigenverantwortlich – jederzeit und überall.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Abgrenzung */}
        <section className="py-12 sm:py-16 px-3 sm:px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
              Wichtige <span className="text-gradient">Abgrenzung</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              ExamFit ersetzt keine betriebliche Ausbildung. Es ergänzt sie dort, wo es am kritischsten wird: bei der konkreten Vorbereitung auf die Prüfung.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">Häufige Fragen</h2>
            <div className="space-y-4">
              {FAQS.map((faq, i) => (
                <details key={i} className="glass-card rounded-2xl p-6 group cursor-pointer">
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {faq.question}
                    <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-12 sm:py-16 px-3 sm:px-4">
          <div className="container mx-auto max-w-2xl text-center space-y-6">
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Prüfungstraining für Ihre Auszubildenden</h2>
            <p className="text-muted-foreground">
              Erfahren Sie, wie ExamFit die Prüfungsvorbereitung Ihrer Auszubildenden strukturiert und transparent unterstützt.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg group">
                Lösungen ansehen
                <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
