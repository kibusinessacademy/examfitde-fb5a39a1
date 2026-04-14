import { Link } from 'react-router-dom';
import { ArrowRight, Brain, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const FAQS = [
  { question: 'Welche Rechnungswesen-Themen werden abgedeckt?', answer: 'Buchführung, Bilanzierung, Gewinn- und Verlustrechnung, Kostenrechnung, Kalkulation und Controlling – von Grundlagen bis Vertiefung.' },
  { question: 'Gibt es Rechenaufgaben mit Lösungsweg?', answer: 'Ja – jede Aufgabe hat eine Schritt-für-Schritt-Erklärung, damit du den Rechenweg nachvollziehen und typische Fehler vermeiden kannst.' },
];

export default function RechnungswesenStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Studium Prüfungsvorbereitung', url: `${SITE_URL}/studium-pruefungsvorbereitung` },
    { name: 'Rechnungswesen Studium' },
  ];

  return (
    <>
      <SEOHead
        title="Rechnungswesen Studium Klausur – Übungen & Prüfungsfragen"
        description="Rechnungswesen-Klausur vorbereiten: Buchführung, Bilanz & Kostenrechnung mit Übungsaufgaben, Lösungen und KI-Feedback. Jetzt online üben!"
        canonical={`${SITE_URL}/rechnungswesen-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Studium Vorbereitung', href: '/studium-pruefungsvorbereitung' },
              { label: 'Rechnungswesen Studium' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30"><Brain className="h-3 w-3 mr-1 inline" /> Rechnungswesen</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Rechnungswesen Studium</span>: Klausur mit Übungen bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Buchführung, Bilanzierung & Kostenrechnung – trainiere mit prüfungsnahen Aufgaben und ausführlichen Lösungswegen.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">Rechnungswesen-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Diese Themen musst du <span className="text-gradient">beherrschen</span></h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {['Buchführung & Kontenrahmen', 'Bilanzierung (HGB)', 'Gewinn- und Verlustrechnung', 'Kostenarten-, Kostenstellen-, Kostenträgerrechnung', 'Kalkulation & Deckungsbeitragsrechnung', 'Abschreibungen & Rückstellungen'].map(t => (
                <div key={t} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="font-medium">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <SEOQuizWidget title="Rechnungswesen-Fragen testen" subtitle="Wie fit bist du in Buchführung & Bilanz?" certificationSlug="bwl" ctaText="Vollständiges Training"  />
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/rechnungswesen-studium" title="Weitere Studium-Themen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Rechnungswesen</h2>
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
            <h2 className="text-3xl font-display font-bold">Rechnungswesen-Klausur sicher bestehen</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
