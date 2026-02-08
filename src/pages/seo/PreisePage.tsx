import { Link } from 'react-router-dom';
import { ArrowRight, Check, BookOpen, Target, Award, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL, PRODUCT_PRICES, generateFAQSchema } from '@/lib/seo';

export default function PreisePage() {
  const products = [
    {
      id: 'lernkurs',
      name: 'Lernkurs',
      price: PRODUCT_PRICES.lernkurs,
      icon: BookOpen,
      color: 'primary',
      description: 'Strukturiertes Lernen aller Prüfungsthemen',
      features: [
        'Alle Lernfelder abgedeckt',
        'Interaktive Lernmodule',
        'KI-Tutor für Fragen',
        'Fortschrittstracking',
        'Mobile-optimiert',
      ],
      notIncluded: ['Prüfungsfragen', 'Mündliche Prüfung'],
      href: '/lernkurse',
    },
    {
      id: 'pruefungstrainer',
      name: 'Prüfungstrainer',
      price: PRODUCT_PRICES.pruefungstrainer,
      icon: Target,
      color: 'accent',
      description: 'Gezieltes Üben mit echten Prüfungsfragen',
      features: [
        'Echte IHK-Prüfungsfragen',
        'Adaptiver Algorithmus',
        'Schwachstellen-Analyse',
        'Prüfungssimulation',
        'Detaillierte Auswertung',
      ],
      notIncluded: ['Lernmaterialien', 'Mündliche Prüfung'],
      href: '/pruefungstrainer',
    },
    {
      id: 'bundle',
      name: 'Komplett-Bundle',
      price: PRODUCT_PRICES.bundle,
      originalPrice: PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer,
      icon: Award,
      color: 'success',
      description: 'Alles in einem Paket – die beste Wahl',
      recommended: true,
      features: [
        'Lernkurs inklusive',
        'Prüfungstrainer inklusive',
        'Mündliche Prüfungssimulation',
        'KI-Prüfer mit Feedback',
        'Prüfungsangst-Management',
        'VARK-Lerntyptest',
      ],
      notIncluded: [],
      href: '/bundle',
    },
  ];

  const faqs = [
    {
      question: 'Wie lange habe ich Zugang?',
      answer: 'Alle Produkte haben eine Laufzeit von 12 Monaten ab Kaufdatum.',
    },
    {
      question: 'Gibt es ein Abo oder Kündigungsfristen?',
      answer: 'Nein, ExamFit funktioniert ohne Abo. Du zahlst einmal und hast 12 Monate Zugang. Keine automatische Verlängerung, keine Kündigung nötig.',
    },
    {
      question: 'Kann ich später upgraden?',
      answer: 'Ja, du kannst jederzeit auf ein höherwertiges Produkt upgraden. Der bereits gezahlte Betrag wird angerechnet.',
    },
    {
      question: 'Gibt es Mengenrabatte für Unternehmen?',
      answer: 'Ja, ab 5 Lizenzen erhältst du automatisch Mengenrabatte bis zu 25%. Die Rabatte werden direkt im Shop berechnet.',
    },
    {
      question: 'Welche Zahlungsmethoden gibt es?',
      answer: 'Wir akzeptieren alle gängigen Zahlungsmethoden: Kreditkarte, PayPal, SEPA-Lastschrift und Überweisung (für B2B).',
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
        title="Preise – IHK-Prüfungsvorbereitung | ExamFit"
        description="Transparente Preise für ExamFit: Lernkurs ab 19€, Prüfungstrainer ab 29€, Komplett-Bundle für 39€. 12 Monate Zugang, kein Abo."
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
                <span className="text-gradient">Transparente Preise</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Einmal zahlen, 12 Monate lernen. Kein Abo, keine versteckten Kosten.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="py-12">
          <div className="container">
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {products.map((product) => {
                const Icon = product.icon;
                return (
                  <Card 
                    key={product.id} 
                    className={`glass-card relative ${product.recommended ? 'ring-2 ring-primary' : ''}`}
                  >
                    {product.recommended && (
                      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                        Empfohlen
                      </Badge>
                    )}
                    <CardHeader className="text-center">
                      <div className={`w-14 h-14 rounded-2xl bg-${product.color}/20 flex items-center justify-center mx-auto mb-4`}>
                        <Icon className={`h-7 w-7 text-${product.color}`} />
                      </div>
                      <CardTitle>{product.name}</CardTitle>
                      <CardDescription>{product.description}</CardDescription>
                      <div className="pt-4">
                        <span className="text-4xl font-bold">{product.price}€</span>
                        {product.originalPrice && (
                          <span className="text-lg text-muted-foreground line-through ml-2">
                            {product.originalPrice}€
                          </span>
                        )}
                        <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          12 Monate Zugang
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-3 mb-6">
                        {product.features.map((feature, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className={`h-4 w-4 text-${product.color} flex-shrink-0 mt-0.5`} />
                            {feature}
                          </li>
                        ))}
                        {product.notIncluded.map((feature, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="w-4 h-4 flex items-center justify-center text-xs">✕</span>
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <Button 
                        className="w-full" 
                        variant={product.recommended ? 'default' : 'outline'}
                        asChild
                      >
                        <Link to={product.href}>
                          Berufe ansehen <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* B2B Hinweis */}
        <section className="py-12">
          <div className="container max-w-3xl">
            <Card className="glass-card">
              <CardContent className="p-8 text-center">
                <Badge variant="outline" className="mb-4">Für Unternehmen</Badge>
                <h3 className="text-xl font-semibold mb-2">
                  Automatische Mengenrabatte ab 5 Lizenzen
                </h3>
                <p className="text-muted-foreground mb-4">
                  Bis zu 25% Rabatt bei größeren Bestellungen. Keine Verhandlung nötig.
                </p>
                <Button variant="outline" asChild>
                  <Link to="/unternehmen">
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
              Bereit für den Prüfungserfolg?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Wähle deinen Beruf und starte noch heute mit der Vorbereitung.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to="/shop">
                Jetzt kaufen <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
