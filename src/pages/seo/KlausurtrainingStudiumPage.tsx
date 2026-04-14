import { Link } from 'react-router-dom';
import { ArrowRight, Target, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const FAQS = [
  { question: 'Was bringt Online-Klausurtraining?', answer: 'Online-Klausurtraining simuliert echte Prüfungsbedingungen mit Timer, MC-Fragen und sofortigem Feedback. Du erkennst Schwächen frühzeitig und trainierst gezielt.' },
  { question: 'Welche Klausurformate werden abgedeckt?', answer: 'Multiple-Choice, offene Fragen, Fallstudien und Rechenaufgaben – alles, was im Studium vorkommt.' },
  { question: 'Kann ich den Schwierigkeitsgrad anpassen?', answer: 'Ja – der KI-Coach passt das Training automatisch an dein Niveau an und steigert die Schwierigkeit progressiv.' },
];

export default function KlausurtrainingStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Studium Prüfungsvorbereitung', url: `${SITE_URL}/studium-pruefungsvorbereitung` },
    { name: 'Klausurtraining Studium' },
  ];

  return (
    <>
      <SEOHead
        title="Klausurtraining Studium – Online Klausuren üben & bestehen"
        description="Online Klausurtraining fürs Studium: Multiple-Choice-Fragen, Prüfungssimulation mit Timer und KI-gestütztes Feedback. Jetzt Klausur üben!"
        canonical={`${SITE_URL}/klausurtraining-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Studium Vorbereitung', href: '/studium-pruefungsvorbereitung' },
              { label: 'Klausurtraining Studium' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30"><Target className="h-3 w-3 mr-1 inline" /> Klausurtraining</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Klausurtraining Studium</span>: Online Klausuren üben
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Trainiere mit echten Prüfungsfragen, realistischem Timer und intelligentem Feedback – genau wie in der echten Klausur.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">So funktioniert das <span className="text-gradient">Klausurtraining</span></h2>
            <div className="space-y-4">
              {[
                'Wähle dein Fach – BWL, Rechnungswesen, Wirtschaftsinformatik und mehr',
                'Starte eine Übungsklausur mit echtem Zeitlimit',
                'Multiple-Choice und offene Fragen wie in der echten Prüfung',
                'Sofortiges Feedback mit Erklärungen zu jeder Antwort',
                'KI-Coach erkennt Schwächen und passt den Lernplan an',
                'Bestehenswahrscheinlichkeit in Echtzeit',
              ].map(p => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <SEOQuizWidget title="Probiere das Klausurtraining" subtitle="5 Fragen – teste dich jetzt" certificationSlug="bwl" ctaText="Vollständiges Training starten"  />
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/klausurtraining-studium" title="Weitere Studium-Themen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Klausurtraining</h2>
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
            <p className="text-xl text-muted-foreground">Nur {PRICING.defaultPrice} – {PRICING.noSubscription.toLowerCase()}.</p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
