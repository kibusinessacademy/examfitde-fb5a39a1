import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import {
  ArrowRight,
  CheckCircle,
  BookOpen,
  Scale,
  Shield,
  Users,
  GraduationCap,
  Eye,
} from 'lucide-react';

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Prüfung hinzuarbeiten.' },
  { question: 'Ersetzt ExamFit Unterricht oder Fachliteratur?', answer: 'Nein. ExamFit ergänzt bestehende Lernwege um ein System für gezieltes Prüfungstraining und messbare Vorbereitung.' },
  { question: 'Für wen ist ExamFit geeignet?', answer: 'ExamFit eignet sich für Auszubildende, Studierende, Teilnehmende in Fort- und Weiterbildungen sowie Personen, die sich auf Zertifizierungsprüfungen vorbereiten.' },
];

export default function PruefungstrainingBerufsschulenPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining als Ergänzung zum Unterricht | Für Berufsschulen und Institutionen')}
        description="Prüfungsnahe Vorbereitung als Ergänzung zum Unterricht: transparente Kompetenzstände, strukturierte Prüfungssimulation und individuelle Unterstützung."
        canonical={`${SITE_URL}/pruefungstraining-berufsschulen`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 sm:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              Prüfungsvorbereitung, die Unterricht{' '}
              <span className="text-gradient text-glow">ergänzt – nicht ersetzt.</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              ExamFit unterstützt Lernende mit gezieltem Prüfungstraining auf Basis prüfungsrelevanter Anforderungen und transparenter Kompetenzentwicklung.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/unternehmen">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Institutionelle Nutzung ansehen
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/berufe">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Verfügbare Berufe ansehen
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Nutzen */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              Was ExamFit für Institutionen <span className="text-gradient">leistet</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { icon: BookOpen, title: 'Ergänzung zur Fachvermittlung', text: 'Kein Unterrichtsersatz – Unterstützung zur selbstständigen Prüfungsvorbereitung.' },
                { icon: Users, title: 'Zusätzliche individuelle Übung', text: 'Lernende trainieren eigenverantwortlich und in ihrem eigenen Tempo.' },
                { icon: Eye, title: 'Transparente Vorbereitung', text: 'Kompetenzstände der Lernenden objektiv einsehbar.' },
                { icon: Shield, title: 'Strukturierte Selbstlernunterstützung', text: 'Alle Inhalte orientieren sich an prüfungsrelevanten Anforderungen.' },
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
              Klare <span className="text-gradient">Abgrenzung</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              ExamFit ist keine Konkurrenz zum Unterricht. Es ist ein ergänzendes Prüfungstrainings-System für selbstständige, gezielte Vorbereitung.
            </p>
          </div>
        </section>

        {/* Einsatzformen */}
        <section className="py-12 sm:py-16 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-8">
              Mögliche <span className="text-gradient">Einsatzformen</span>
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { icon: GraduationCap, title: 'Empfehlung', text: 'Als empfohlenes Tool zur individuellen Prüfungsvorbereitung.' },
                { icon: BookOpen, title: 'Unterrichtsergänzung', text: 'Ergänzend zum Berufsschulunterricht für die Prüfungsphase.' },
                { icon: Users, title: 'Individuelle Förderung', text: 'Gezielte Unterstützung leistungsschwächerer Lernender.' },
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
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Informationen für Ihre Institution</h2>
            <p className="text-muted-foreground">
              Erfahren Sie, wie ExamFit die Prüfungsvorbereitung Ihrer Lernenden strukturiert und transparent unterstützt.
            </p>
            <Link to="/unternehmen">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg group">
                Institutionelle Nutzung ansehen
                <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
