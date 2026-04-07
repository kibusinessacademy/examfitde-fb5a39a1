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
  Clock3,
  GraduationCap,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Prüfung hinzuarbeiten.' },
  { question: 'Ist ExamFit für echte Prüfungen oder nur zum Üben gedacht?', answer: 'ExamFit ist für gezielte Prüfungsvorbereitung gedacht. Der Fokus liegt auf prüfungsnahen Trainingsformaten, Simulationen und einer strukturierten Vorbereitung auf reale Leistungsnachweise.' },
  { question: 'Ersetzt ExamFit Vorlesungen oder Fachliteratur?', answer: 'Nein. ExamFit ergänzt bestehende Lernwege um ein System für gezieltes Prüfungstraining und messbare Vorbereitung.' },
  { question: 'Warum ist Prüfungstraining wichtiger als nur Inhalte zu lesen?', answer: 'Weil Prüfungsleistung nicht nur aus Wissen besteht, sondern aus Anwendung, Sicherheit, Aufgabenverständnis und Zeitmanagement. Genau darauf ist ExamFit ausgerichtet.' },
];

export default function PruefungstrainingStudiumPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining fürs Studium | Klausuren gezielt vorbereiten')}
        description="Gezielte Klausur- und Prüfungsvorbereitung im Studium: strukturiertes Training, typische Prüfungsformate, klare Schwächenanalyse und messbarer Lernfortschritt."
        canonical={`${SITE_URL}/pruefungstraining-studium`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 sm:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <GraduationCap className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">Klausurtraining · Transferaufgaben · Prüfungsreife</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Prüfungstraining fürs Studium –{' '}
              <span className="text-gradient text-glow">gezielt auf Klausuren statt auf Stoffberge.</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Bereite dich strukturiert auf Hochschulprüfungen vor: mit fokussiertem Training, typischen Prüfungsformaten und klarer Rückmeldung zu deinem Leistungsstand.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Prüfungstraining fürs Studium entdecken
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/pruefungsreife-check">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Wissensstand testen
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Pain Points */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              Warum klassische Vorbereitung <span className="text-gradient">oft nicht reicht</span>
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { icon: XCircle, title: 'Zu viel Stoff', text: 'Im Studium scheitert Prüfungsvorbereitung oft nicht an zu wenig Material, sondern an zu wenig Struktur.' },
                { icon: AlertTriangle, title: 'Transfer statt Wiedergabe', text: 'Die Klausur fragt nicht „Was ist X?" – sondern „Wie wendest du X in Situation Y an?"' },
                { icon: Clock3, title: 'Unsicheres Leistungsgefühl', text: 'Zu wenig Zeit, unklar was relevant ist, unsicheres Gefühl trotz Lernen.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-destructive mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-muted-foreground mt-8 max-w-2xl mx-auto">
              ExamFit hilft dir, den Stoff auf prüfungsrelevante Aufgabenlogik herunterzubrechen.
            </p>
          </div>
        </section>

        {/* USP */}
        <section className="py-12 sm:py-16 px-3 sm:px-4">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              So unterstützt ExamFit deine <span className="text-gradient">Klausurvorbereitung</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { icon: Target, title: 'Strukturierte Prüfungsvorbereitung', text: 'Trainiere nicht abstrakt, sondern in Formaten, die dich auf echte Klausursituationen vorbereiten.' },
                { icon: BarChart3, title: 'Fokus auf typische Anforderungen', text: 'Übe Transferaufgaben, Fallanalysen und Modellvergleiche – die häufigsten Stolpersteine.' },
                { icon: Search, title: 'Gezielte Schwächenanalyse', text: 'Erkenne, wo du noch unsicher bist und woran du gezielt arbeiten solltest.' },
                { icon: Brain, title: 'Realistisches Prüfungsgefühl', text: 'Simulation unter realistischen Bedingungen für ein belastbares Leistungsgefühl.' },
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
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Bereit für dein Klausurtraining?</h2>
            <p className="text-muted-foreground">Starte jetzt und bereite dich gezielt auf deine Hochschulprüfung vor.</p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg group">
                Prüfungstraining fürs Studium entdecken
                <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
