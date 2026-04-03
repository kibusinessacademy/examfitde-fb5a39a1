import { Link } from 'react-router-dom';
import { ArrowRight, Check, Shield, Clock, CreditCard, GraduationCap, Briefcase, BookOpen, Users, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL, generateFAQSchema } from '@/lib/seo';
import { PricingCards } from '@/components/pricing/PricingCards';

export default function PreisePage() {
  const faqs = [
    {
      question: 'Wie lange habe ich Zugang?',
      answer: 'Du hast 12 Monate ab Kaufdatum vollen Zugang zu allen Funktionen.',
    },
    {
      question: 'Gibt es ein Abo oder Kündigungsfristen?',
      answer: 'Nein. Du zahlst einmal und hast 12 Monate Zugang. Keine automatische Verlängerung, keine Kündigung nötig.',
    },
    {
      question: 'Was ist der Unterschied zwischen Ausbildung und Studium?',
      answer: 'Der Prüfungstrainer ist identisch – Inhalte und Didaktik passen sich automatisch an. Im Studium liegt der Fokus auf Fallanalysen, Transferaufgaben und akademischer Klausurvorbereitung.',
    },
    {
      question: 'Können duale Studenten über den Betrieb lizenziert werden?',
      answer: 'Ja. Duale Studenten laufen automatisch über die B2B-Lizenz des Betriebs. Ein separates Produkt ist nicht nötig.',
    },
    {
      question: 'Welche Zahlungsmethoden gibt es?',
      answer: 'Wir akzeptieren Kreditkarte, PayPal, SEPA-Lastschrift und Überweisung (für B2B).',
    },
    {
      question: 'Bekomme ich eine Rechnung?',
      answer: 'Ja, nach dem Kauf erhältst du automatisch eine ordentliche Rechnung mit ausgewiesener MwSt.',
    },
  ];

  const structuredData = generateFAQSchema(faqs);

  return (
    <>
      <SEOHead
        title="Preise – Prüfungstraining für Ausbildung & Studium | ExamFit"
        description="ExamFit Prüfungstraining: Ausbildung ab 39 €, Studium ab 59 €. Einmalzahlung, 12 Monate Zugang, kein Abo. Team-Lizenzen für Betriebe & Hochschulen."
        canonical={`${SITE_URL}/preise`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'Preise' }]} className="mb-8" />
            <div className="max-w-3xl text-center mx-auto">
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Ein System. Zwei Welten. <span className="text-gradient">Bestehen.</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-4">
                Einmal zahlen, 12 Monate trainieren. Kein Abo, keine versteckten Kosten.
              </p>
            </div>
          </div>
        </section>

        {/* Trust Badges */}
        <div className="flex flex-wrap justify-center gap-6 mb-12 px-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-primary" />
            <span>Sichere Zahlung via Stripe</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4 text-primary" />
            <span>Sofortiger Zugang nach Kauf</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="w-4 h-4 text-primary" />
            <span>Einmalzahlung, kein Abo</span>
          </div>
        </div>

        {/* Dynamic Pricing Cards */}
        <section className="py-12 px-4">
          <div className="container">
            <PricingCards />
          </div>
        </section>

        {/* Zielgruppen */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Ein Produkt – <span className="text-gradient">passend für jede Rolle</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Link to="/pruefungstraining-azubis" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <Target className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-display font-bold mb-2">Für Auszubildende</h3>
                <p className="text-sm text-muted-foreground mb-3">Prüfung simulieren, Schwächen erkennen, sicher bestehen.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <Link to="/pruefungstraining-studium" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <GraduationCap className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-display font-bold mb-2">Für Studierende</h3>
                <p className="text-sm text-muted-foreground mb-3">Klausuren bestehen mit Fallanalysen und Transfertraining.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <Link to="/pruefungstraining-betriebe" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <Users className="h-8 w-8 text-accent mb-3" />
                <h3 className="font-display font-bold mb-2">Für Betriebe</h3>
                <p className="text-sm text-muted-foreground mb-3">Bestehensquoten erhöhen – Azubis & duale Studenten.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <Link to="/pruefungstraining-institutionen" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <BookOpen className="h-8 w-8 text-success mb-3" />
                <h3 className="font-display font-bold mb-2">Für Hochschulen</h3>
                <p className="text-sm text-muted-foreground mb-3">Prüfungskonforme Ergänzung für Modulprüfungen.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Häufige Fragen zu Preisen & Kauf
            </h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <details key={index} className="glass-card rounded-2xl p-6 group cursor-pointer">
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {faq.question}
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Bereit für deine Prüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Egal ob Ausbildung oder Studium – du trainierst immer prüfungsrelevant.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg" asChild>
              <Link to="/pruefungsreife-check">
                Prüfungsreife kostenlos testen <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
