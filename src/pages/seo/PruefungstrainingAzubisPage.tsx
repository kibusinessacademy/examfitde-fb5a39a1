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
  Search,
  BarChart3,
  ClipboardCheck,
} from 'lucide-react';

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Prüfung hinzuarbeiten.' },
  { question: 'Ist ExamFit für echte Prüfungen oder nur zum Üben gedacht?', answer: 'ExamFit ist für gezielte Prüfungsvorbereitung gedacht. Der Fokus liegt auf prüfungsnahen Trainingsformaten, Simulationen und einer strukturierten Vorbereitung auf reale Leistungsnachweise.' },
  { question: 'Ersetzt ExamFit Unterricht oder Fachliteratur?', answer: 'Nein. ExamFit ergänzt bestehende Lernwege um ein System für gezieltes Prüfungstraining und messbare Vorbereitung.' },
  { question: 'Warum ist Prüfungstraining wichtiger als nur Inhalte zu lesen?', answer: 'Weil Prüfungsleistung nicht nur aus Wissen besteht, sondern aus Anwendung, Sicherheit, Aufgabenverständnis und Zeitmanagement. Genau darauf ist ExamFit ausgerichtet.' },
];

export default function PruefungstrainingAzubisPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining für Azubis | Abschlussprüfung sicher bestehen')}
        description="Für Azubis, die ihre Abschlussprüfung sicher bestehen wollen: trainiere mit prüfungsnahen Fragen, Simulationen und KI-gestütztem Feedback."
        canonical={`${SITE_URL}/pruefungstraining-azubis`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 sm:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <ClipboardCheck className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">Abschlussprüfung gezielt vorbereiten</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Bestehe deine Abschlussprüfung mit{' '}
              <span className="text-gradient text-glow">gezieltem Prüfungstraining.</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Trainiere genau die Aufgabenarten, die für deine Prüfung relevant sind – mit sofortigem Feedback und klarer Einschätzung deiner Prüfungsreife.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Jetzt Prüfungstraining starten
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

        {/* Suchintention / Problem */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
              Du brauchst vor der Prüfung <span className="text-gradient">nicht noch mehr Theorie.</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Du brauchst ein System, das dir zeigt: wo du stehst, was dir noch fehlt, welche Fehler du wiederholt machst und wie du prüfungssicher wirst.
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
                { icon: Target, title: 'Prüfungsnahe Aufgabenformate', text: 'Trainiere nicht abstrakt, sondern in Formaten, die dich auf echte Prüfungssituationen vorbereiten.' },
                { icon: BarChart3, title: 'Simulation unter realistischen Bedingungen', text: 'Übe strukturiert und entwickle ein belastbares Gefühl für deine tatsächliche Prüfungsleistung.' },
                { icon: Search, title: 'Transparente Schwächenanalyse', text: 'Erkenne, wo du noch unsicher bist und woran du gezielt arbeiten solltest.' },
                { icon: Brain, title: 'Gezieltes Feedback', text: 'Nicht nur richtig oder falsch, sondern Hinweise, wo Verständnis, Sicherheit oder Anwendung fehlen.' },
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

        {/* Einwände */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-8">
              Typische <span className="text-gradient">Einwände</span>
            </h2>
            <div className="space-y-4">
              {[
                { objection: '„Ich lerne doch schon."', answer: 'Ja – aber Lernen allein ist nicht dasselbe wie prüfungsorientiertes Training.' },
                { objection: '„Ich weiß nicht, ob ich bereit bin."', answer: 'Genau dafür ist ExamFit da: Deine Prüfungsreife wird sichtbar.' },
                { objection: '„Ich verliere mich in zu viel Stoff."', answer: 'ExamFit lenkt den Fokus auf prüfungsrelevante Inhalte und typische Aufgabenmuster.' },
              ].map(({ objection, answer }) => (
                <div key={objection} className="glass-card rounded-2xl p-6">
                  <p className="font-semibold mb-2">{objection}</p>
                  <p className="text-sm text-muted-foreground">{answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 px-3 sm:px-4">
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
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-2xl text-center space-y-6">
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Bereit für dein Prüfungstraining?</h2>
            <p className="text-muted-foreground">Starte jetzt und bestehe deine Abschlussprüfung sicher.</p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg group">
                Jetzt Prüfungstraining starten
                <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
