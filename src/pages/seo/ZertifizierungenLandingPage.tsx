import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle, generateFAQSchema } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import {
  ArrowRight,
  CheckCircle,
  Award,
  Brain,
  Target,
  Clock,
  Shield,
  FileCheck,
  BookOpen,
  Zap,
  Layers,
  BarChart3,
} from 'lucide-react';

const CERTIFICATIONS = [
  { title: 'Scrum Master (PSM I/CSM)', category: 'Agile', popular: true },
  { title: 'PRINCE2 Foundation', category: 'Projektmanagement', popular: true },
  { title: 'ITIL Foundation', category: 'IT-Service', popular: true },
  { title: 'AWS Cloud Practitioner', category: 'Cloud', popular: false },
  { title: 'Six Sigma Green Belt', category: 'Qualität', popular: false },
  { title: 'PMP / CAPM', category: 'Projektmanagement', popular: false },
];

const FEATURES = [
  { icon: Target, title: 'Prüfungssimulation', desc: 'Originalnahe Prüfungsfragen mit Zeitlimit – so realistisch wie die echte Zertifikatsprüfung.' },
  { icon: Brain, title: 'KI-Prüfungscoach', desc: 'Sofortiges Feedback und Erklärungen zu jeder Frage. Verstehe, nicht nur auswendig lernen.' },
  { icon: Layers, title: 'Strukturierter Lernpfad', desc: 'Prüfungsrelevante Themen in optimaler Reihenfolge – kein unnötiger Ballast.' },
  { icon: BarChart3, title: 'Fortschritts-Tracking', desc: 'Sieh auf einen Blick, welche Bereiche du beherrschst und wo du nacharbeiten musst.' },
  { icon: BookOpen, title: 'Kompakt-Wissen', desc: 'Alle prüfungsrelevanten Konzepte strukturiert aufbereitet und jederzeit abrufbar.' },
  { icon: FileCheck, title: 'Prüfungsreife-Check', desc: 'Objektive Einschätzung: Bist du bereit für die Zertifikatsprüfung?' },
];

const FAQS = [
  {
    question: 'Welche Zertifizierungen werden unterstützt?',
    answer: 'ExamFit unterstützt gängige Zertifizierungsprüfungen aus den Bereichen Projektmanagement, Agile, IT-Service und Cloud. Die Inhalte werden kontinuierlich erweitert.',
  },
  {
    question: 'Was kostet die Zertifizierungsvorbereitung?',
    answer: `Das Prüfungstraining kostet ${PRICING.defaultPrice} einmalig für ${PRICING.defaultAccess} Zugang. ${PRICING.noSubscription}, keine versteckten Kosten.`,
  },
  {
    question: 'Wie prüfungsnah sind die Fragen?',
    answer: 'Alle Fragen orientieren sich an den offiziellen Prüfungsformaten und -inhalten der jeweiligen Zertifizierung. Der KI-Coach erklärt die Hintergründe zu jeder Antwort.',
  },
  {
    question: 'Kann mein Arbeitgeber die Kosten übernehmen?',
    answer: `Ja. Viele Arbeitgeber übernehmen Zertifizierungskosten. ExamFit bietet ab 10 Lizenzen Team-Rabatte (ab ${PRICING.b2b.tiers[0].unitPriceDisplay}/Lizenz).`,
  },
  {
    question: 'Wie schnell kann ich die Prüfung bestehen?',
    answer: 'Das hängt von der Zertifizierung und deinem Vorwissen ab. Typischerweise reichen 2–6 Wochen gezieltes Training mit ExamFit für eine erfolgreiche Prüfung.',
  },
];

export default function ZertifizierungenLandingPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Zertifizierung vorbereiten: Prüfungstraining für Scrum, PRINCE2, AWS & mehr')}
        description={`Zertifizierungsprüfung bestehen: Prüfungssimulation & KI-Coach für Scrum, PRINCE2, ITIL, AWS. Strukturiert, prüfungsnah, ${PRICING.defaultPrice} einmalig.`}
        canonical={`${SITE_URL}/zertifizierungen`}
        structuredData={generateFAQSchema(FAQS)}
      />
      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Award className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Schneller Kompetenznachweis – gezielt vorbereiten</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              Zertifizierung vorbereiten:{' '}
              <span className="text-gradient text-glow">Prüfung sicher bestehen</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Strukturierte Vorbereitung auf Zertifikatsprüfungen – prüfungsnah, adaptiv und mit 
              KI-gestütztem Feedback. Für schnellen Kompetenznachweis.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg">
                  Zertifizierung vorbereiten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/exam-simulation">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Prüfung simulieren
                </Button>
              </Link>
            </div>

            {/* Trust bar */}
            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> {PRICING.defaultAccess} Zugang</span>
              <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> {PRICING.noSubscription}</span>
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> {PRICING.defaultPrice} einmalig</span>
            </div>
          </div>
        </section>

        {/* Certifications Grid */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">Unterstützte Zertifizierungen</h2>
            <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
              Wähle deine Zertifizierung – die Prüfungsinhalte passen sich automatisch an.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CERTIFICATIONS.map((c) => (
                <Card key={c.title} className="p-5 flex items-center gap-3 hover:border-primary/50 transition-colors">
                  <Award className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-semibold">{c.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">{c.category}</Badge>
                      {c.popular && <Badge className="text-xs bg-primary/10 text-primary border-0">Beliebt</Badge>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-12">Dein Weg zur Zertifizierung</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="p-6 space-y-3">
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <h3 className="font-semibold text-lg">{title}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Price Anchor */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-3xl text-center">
            <p className="text-muted-foreground mb-2">Klassische Zertifizierungskurse</p>
            <p className="text-3xl font-bold line-through text-muted-foreground/60">500–2.000 €</p>
            <p className="text-muted-foreground mt-4">ExamFit Prüfungstraining</p>
            <p className="text-5xl font-display font-bold text-gradient">{PRICING.defaultPrice}</p>
            <p className="text-sm text-muted-foreground mt-1">einmalig · {PRICING.defaultAccess} · {PRICING.noSubscription}</p>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-16 px-4">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-8">Warum ExamFit für Zertifizierungen?</h2>
            <div className="space-y-4">
              {[
                'Prüfungsfragen im Original-Format deiner Zertifizierung',
                'KI-Coach erklärt Hintergründe – nicht nur richtig/falsch',
                'Strukturierter Lernpfad statt unstrukturiertes Nachlesen',
                'Flexible Vorbereitung – lerne in deinem eigenen Tempo',
                `Nur ${PRICING.defaultPrice} statt 500–2.000 € für klassische Kurse`,
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 p-4 glass-card rounded-xl">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-12">Häufige Fragen zu Zertifizierungen</h2>
            <div className="space-y-4">
              {FAQS.map((faq, i) => (
                <details key={i} className="glass-card rounded-2xl p-6 group cursor-pointer">
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {faq.question}
                    <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 px-4">
          <div className="container max-w-2xl text-center space-y-6">
            <h2 className="text-3xl font-bold">Bereit für deine Zertifizierung?</h2>
            <p className="text-muted-foreground">
              Starte jetzt die Vorbereitung – {PRICING.defaultPrice} für {PRICING.defaultAccess}.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg">
                Zertifizierung vorbereiten
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
