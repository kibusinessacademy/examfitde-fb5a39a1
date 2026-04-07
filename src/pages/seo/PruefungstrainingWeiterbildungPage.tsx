import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import {
  ArrowRight,
  CheckCircle,
  Target,
  Brain,
  TrendingUp,
  Compass,
  RefreshCw,
  Search,
  BarChart3,
} from 'lucide-react';

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Prüfung hinzuarbeiten.' },
  { question: 'Ist ExamFit für echte Prüfungen oder nur zum Üben gedacht?', answer: 'ExamFit ist für gezielte Prüfungsvorbereitung gedacht. Der Fokus liegt auf prüfungsnahen Trainingsformaten, Simulationen und einer strukturierten Vorbereitung auf reale Leistungsnachweise.' },
  { question: 'Für wen ist ExamFit geeignet?', answer: 'ExamFit eignet sich für Auszubildende, Studierende, Teilnehmende in Fort- und Weiterbildungen sowie Personen, die sich auf Zertifizierungsprüfungen vorbereiten.' },
  { question: 'Ersetzt ExamFit Unterricht oder Fachliteratur?', answer: 'Nein. ExamFit ergänzt bestehende Lernwege um ein System für gezieltes Prüfungstraining und messbare Vorbereitung.' },
  { question: 'Warum ist Prüfungstraining wichtiger als nur Inhalte zu lesen?', answer: 'Weil Prüfungsleistung nicht nur aus Wissen besteht, sondern aus Anwendung, Sicherheit, Aufgabenverständnis und Zeitmanagement. Genau darauf ist ExamFit ausgerichtet.' },
];

export default function PruefungstrainingWeiterbildungPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining für Weiterbildungen | Strukturierte Vorbereitung mit System')}
        description="Bereite dich mit strukturiertem Prüfungstraining gezielt auf Prüfungen in der Weiterbildung vor – mit Simulationen, Aufgabenlogik und transparenter Vorbereitung."
        canonical={`${SITE_URL}/pruefungstraining-weiterbildung`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 sm:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Prüfungstraining für deine Weiterbildung –{' '}
              <span className="text-gradient text-glow">mit System statt Zufall.</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Trainiere prüfungsrelevante Inhalte strukturiert, erkenne Schwächen frühzeitig und bereite dich gezielt auf den Leistungsnachweis vor.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Weiterbildungs-Prüfungstraining entdecken
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/pruefungsreife-check">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Prüfungsreife testen
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
              Warum klassische Vorbereitung <span className="text-gradient">oft nicht reicht</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              In vielen Weiterbildungen fehlt ein klarer Übergang zwischen Lernen und tatsächlicher Prüfungsleistung. ExamFit schließt genau diese Lücke – nicht nur Inhalte durcharbeiten, sondern trainieren, anwenden, prüfen, verbessern.
            </p>
          </div>
        </section>

        {/* USP */}
        <section className="py-12 sm:py-16 px-3 sm:px-4">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              So unterstützt ExamFit deine <span className="text-gradient">Prüfungsvorbereitung</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { icon: Target, title: 'Strukturiertes Training', text: 'Trainiere nicht abstrakt, sondern in Formaten, die dich auf echte Prüfungssituationen vorbereiten.' },
                { icon: BarChart3, title: 'Realistische Simulation', text: 'Übe strukturiert und entwickle ein belastbares Gefühl für deine tatsächliche Prüfungsleistung.' },
                { icon: Search, title: 'Schwächen früh erkennen', text: 'Erkenne, wo du noch unsicher bist und woran du gezielt arbeiten solltest.' },
                { icon: TrendingUp, title: 'Sicherer in Leistungsnachweise', text: 'Weniger Aktionismus kurz vor der Prüfung, mehr Klarheit über Prioritäten und Fortschritt.' },
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
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Bereit für dein Prüfungstraining?</h2>
            <p className="text-muted-foreground">
              Starte jetzt und bereite dich gezielt auf deine Weiterbildungsprüfung vor.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg group">
                Weiterbildungs-Prüfungstraining entdecken
                <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
