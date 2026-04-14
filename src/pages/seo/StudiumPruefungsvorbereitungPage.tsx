import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, BookOpen, Target, Brain, Calendar, Heart, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const CLUSTERS = [
  { title: 'Klausurtraining', desc: 'Online Klausuren üben mit MC-Fragen & Timer', href: '/klausurtraining-studium', icon: Target },
  { title: 'BWL Klausur', desc: 'BWL-Prüfungsfragen mit Lösungen', href: '/bwl-klausur', icon: BookOpen },
  { title: 'Rechnungswesen', desc: 'Bilanz, Buchführung & Kostenrechnung', href: '/rechnungswesen-studium', icon: Brain },
  { title: 'Lernplan Studium', desc: 'Effektiver Lernplan für deine Klausur', href: '/lernplan-studium', icon: Calendar },
  { title: 'Prüfungsangst', desc: 'Klausurangst überwinden & Stress reduzieren', href: '/pruefungsangst-studium', icon: Heart },
  { title: 'Mündliche Prüfung', desc: 'Mündliche Klausur & Verteidigung vorbereiten', href: '/muendliche-pruefung-studium', icon: MessageSquare },
];

const FAQS = [
  { question: 'Wie bereite ich mich effektiv auf Klausuren im Studium vor?', answer: 'Die beste Klausurvorbereitung kombiniert aktives Üben mit echten Prüfungsfragen, Spaced Repetition und einem strukturierten Lernplan. ExamFit bietet genau das – mit KI-Coach und Prüfungssimulation.' },
  { question: 'Welche Fächer kann ich mit ExamFit trainieren?', answer: 'ExamFit bietet Klausurtraining für BWL, Rechnungswesen, Wirtschaftsinformatik und weitere Studiengänge. Alle Module basieren auf echten Prüfungsformaten.' },
  { question: 'Hilft ExamFit auch bei mündlichen Prüfungen?', answer: 'Ja – ExamFit trainiert gezielt mündliche Prüfungssituationen mit Beispielfragen, Fachgespräch-Simulation und Tipps zur Präsentation.' },
  { question: 'Was kostet das Klausurtraining?', answer: `ExamFit kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang. Alle Module inklusive.` },
];

export default function StudiumPruefungsvorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Studium Prüfungsvorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="Studium Prüfungsvorbereitung – Klausurtraining, Lernplan & Tipps"
        description="Klausurvorbereitung fürs Studium: Online Klausurtraining, BWL & Rechnungswesen Übungen, Lernplan und KI-Coach. Jetzt Klausuren sicher bestehen!"
        canonical={`${SITE_URL}/studium-pruefungsvorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Studium Prüfungsvorbereitung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Studium</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Studium Prüfungsvorbereitung</span>: Klausuren sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Strukturiertes Klausurtraining mit echten Prüfungsfragen, Lernplan-Generator und KI-Coach – für Bachelor & Master.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/klausurtraining-studium">Klausur üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Dein Weg zur <span className="text-gradient">Klausur</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {CLUSTERS.map(c => (
                <Link key={c.href} to={c.href}>
                  <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group">
                    <CardContent className="pt-6 space-y-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary w-fit"><c.icon className="h-6 w-6" /></div>
                      <h3 className="font-semibold group-hover:text-primary transition-colors">{c.title}</h3>
                      <p className="text-sm text-muted-foreground">{c.desc}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="Teste dein Klausurwissen"
              subtitle="5 Fragen – wie gut bist du vorbereitet?"
              certificationSlug="bwl"
              ctaText="Jetzt Klausurtraining starten"
              ctaLink="/shop"
            />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Warum Klausurvorbereitung mit <span className="text-gradient">ExamFit</span>?</h2>
            <div className="space-y-4">
              {[
                'Echte Prüfungsfragen aus BWL, Rechnungswesen und mehr',
                'Realistische Klausursimulation mit Zeitvorgabe',
                'KI-Coach erkennt Wissenslücken und erstellt deinen Lernplan',
                'Spaced Repetition für nachhaltiges Lernen',
                'Mündliche Prüfung gezielt trainieren',
                'Einmalzahlung, kein Abo – voller Zugang',
              ].map(p => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/studium-pruefungsvorbereitung" linkTypes={['pillar_to_cluster']} title="Studium-Themen vertiefen" />
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/studium-pruefungsvorbereitung" linkTypes={['cluster_to_product']} title="Klausurtraining für dein Fach" maxLinks={6} />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur Studium-Prüfungsvorbereitung</h2>
            <div className="space-y-3">
              {FAQS.map(faq => (
                <details key={faq.question} className="group border border-border rounded-lg bg-card">
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">{faq.question}</summary>
                  <p className="px-6 pb-4 text-sm text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl font-display font-bold">Bereit für deine Klausur?</h2>
            <p className="text-xl text-muted-foreground">Starte jetzt – nur {PRICING.defaultPrice} für {PRICING.defaultAccess}.</p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
