import { Link } from 'react-router-dom';
import { ArrowRight, Check, Target, Clock, Shield, Brain, Mic, BookOpen, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL, PRODUCT_PRICES, generateFAQSchema } from '@/lib/seo';

export default function PreisePage() {
  const features = [
    'Prüfungssimulation (schriftlich & mündlich)',
    'KI-Prüfungscoach mit Feedback',
    'Adaptive Schwächenanalyse',
    'Prüfungswissen kompakt',
    'Prüfungsreife-Indikator',
    'Prüfungsangst-Management',
    'VARK-Lerntyptest',
    'Spaced Repetition',
  ];

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
      question: 'Gibt es Mengenrabatte für Ausbildungsbetriebe?',
      answer: 'Ja, ab 5 Lizenzen erhältst du automatisch Mengenrabatte bis zu 25 %. Die Rabatte werden direkt im Shop berechnet.',
    },
    {
      question: 'Welche Zahlungsmethoden gibt es?',
      answer: 'Wir akzeptieren Kreditkarte, PayPal, SEPA-Lastschrift und Überweisung (für B2B).',
    },
    {
      question: 'Bekomme ich eine Rechnung?',
      answer: 'Ja, nach dem Kauf erhältst du automatisch eine ordentliche Rechnung mit ausgewiesener MwSt.',
    },
    {
      question: 'Was ist im Prüfungstraining enthalten?',
      answer: 'Alles, was du für die Abschlussprüfung brauchst: Prüfungssimulationen, mündliche Prüfung, KI-Prüfungscoach, Prüfungswissen, Schwächenanalyse und Prüfungsreife-Indikator.',
    },
  ];

  const structuredData = generateFAQSchema(faqs);

  return (
    <>
      <SEOHead
        title="Preise – Intelligentes Prüfungstraining | ExamFit"
        description="Ein Produkt, ein Ziel: Prüfung bestehen. ExamFit Prüfungstraining für 39 € – 12 Monate Zugang, kein Abo. Für Auszubildende und Ausbildungsbetriebe."
        canonical={`${SITE_URL}/preise`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[{ label: 'Preise' }]}
              className="mb-8"
            />

            <div className="max-w-3xl text-center mx-auto">
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Ein Produkt. Ein Ziel. <span className="text-gradient">Bestehen.</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-4">
                Einmal zahlen, 12 Monate trainieren. Kein Abo, keine versteckten Kosten.
              </p>
            </div>
          </div>
        </section>

        {/* Single Product Card */}
        <section className="py-12">
          <div className="container">
            <div className="max-w-2xl mx-auto">
              <Card className="glass-card ring-2 ring-primary relative">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                  Alles inklusive
                </Badge>
                <CardHeader className="text-center pt-8">
                  <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-glow">
                    <Target className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <CardTitle className="text-2xl font-display">Intelligentes Prüfungstraining</CardTitle>
                  <p className="text-muted-foreground mt-2">
                    Alles, was du für die IHK-Abschlussprüfung brauchst – in einem System.
                  </p>
                  <div className="pt-6">
                    <span className="text-5xl font-display font-bold text-gradient">{PRODUCT_PRICES.pruefungstraining} €</span>
                    <div className="text-sm text-muted-foreground mt-2 flex items-center justify-center gap-4">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> 12 Monate</span>
                      <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Kein Abo</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-8">
                  <ul className="grid sm:grid-cols-2 gap-3 mb-8">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="lg"
                    className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg"
                    asChild
                  >
                    <Link to="/shop">
                      Jetzt Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Zielgruppen */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Ein Produkt – <span className="text-gradient">passend für jede Rolle</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <Link to="/pruefungstraining-azubis" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <Target className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-display font-bold mb-2">Für Auszubildende</h3>
                <p className="text-sm text-muted-foreground mb-3">Prüfung simulieren, Schwächen erkennen, sicher bestehen.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <Link to="/pruefungstraining-betriebe" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <Users className="h-8 w-8 text-accent mb-3" />
                <h3 className="font-display font-bold mb-2">Für Ausbildungsbetriebe</h3>
                <p className="text-sm text-muted-foreground mb-3">Bestehensquoten erhöhen, Prüfungsreife messen.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <Link to="/pruefungstraining-institutionen" className="glass-card rounded-2xl p-6 group hover:border-primary/30 transition-all">
                <BookOpen className="h-8 w-8 text-success mb-3" />
                <h3 className="font-display font-bold mb-2">Für Berufsschulen & IHK</h3>
                <p className="text-sm text-muted-foreground mb-3">Prüfungskonforme Ergänzung, nicht Ersatz des Unterrichts.</p>
                <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                  Mehr erfahren <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* B2B Hinweis */}
        <section className="py-12">
          <div className="container max-w-3xl">
            <Card className="glass-card">
              <CardContent className="p-8 text-center">
                <Badge variant="outline" className="mb-4">Für Ausbildungsbetriebe</Badge>
                <h3 className="text-xl font-semibold mb-2">
                  Automatische Mengenrabatte ab 5 Lizenzen
                </h3>
                <p className="text-muted-foreground mb-4">
                  Bis zu 25 % Rabatt bei größeren Bestellungen. Keine Verhandlung nötig.
                </p>
                <Button variant="outline" asChild>
                  <Link to="/pruefungstraining-betriebe">
                    Mehr erfahren <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Häufige Fragen zu Preisen & Kauf
            </h2>
            <div className="space-y-6">
              {faqs.map((faq, index) => (
                <Card key={index} className="glass-card">
                  <CardHeader>
                    <CardTitle className="text-lg">{faq.question}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-muted-foreground">{faq.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Bereit für die Abschlussprüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Starte jetzt dein Prüfungstraining und geh sicher in die Prüfung.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
              <Link to="/shop">
                Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}