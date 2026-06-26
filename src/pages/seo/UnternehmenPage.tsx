import { Link } from 'react-router-dom';
import { ArrowRight, Check, Building2, School, Award, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL, PRODUCT_PRICES, generateOrganizationSchema } from '@/lib/seo';
import { formatEuro } from '@/lib/priceFormat';

export default function UnternehmenPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'WebPage',
        name: 'ExamFit für Unternehmen & Schulen',
        description: 'IHK-Prüfungsvorbereitung für Ausbildungsbetriebe, Berufsschulen und Bildungsträger. Automatische Mengenrabatte.',
        url: `${SITE_URL}/unternehmen`,
      },
    ],
  };

  const segments = [
    {
      id: 'ausbildung',
      title: 'Ausbildungsbetriebe',
      icon: Building2,
      description: 'Unterstützen Sie Ihre Azubis optimal bei der IHK-Prüfungsvorbereitung.',
      benefits: [
        'Höhere Prüfungserfolgsquote',
        'Weniger Ausbildungsabbrüche',
        'Strukturiertes Selbstlernen',
        'Fortschrittstracking für Ausbilder',
      ],
      href: '/unternehmen/ausbildung',
    },
    {
      id: 'schulen',
      title: 'Berufsschulen',
      icon: School,
      description: 'Ergänzen Sie Ihren Unterricht mit interaktiven Lernmaterialien.',
      benefits: [
        'Curriculumskonforme Inhalte',
        'H5P-Integration',
        'Klassenverwaltung',
        'Lernstandsberichte',
      ],
      href: '/unternehmen/berufsschulen',
    },
    {
      id: 'ihk',
      title: 'IHK & Bildungsträger',
      icon: Award,
      description: 'Bieten Sie Ihren Prüflingen zusätzliche Vorbereitungsmaterialien.',
      benefits: [
        'AZAV-konforme Dokumentation',
        'Prüfungsnahe Fragen',
        'Mündliche Prüfungssimulation',
        'White-Label möglich',
      ],
      href: '/unternehmen/ihk',
    },
  ];

  const pricingTiers = [
    { seats: '1-4', discount: 0, perSeat: PRODUCT_PRICES.bundle },
    { seats: '5-9', discount: 10, perSeat: Math.round(PRODUCT_PRICES.bundle * 0.9) },
    { seats: '10-24', discount: 15, perSeat: Math.round(PRODUCT_PRICES.bundle * 0.85) },
    { seats: '25-49', discount: 20, perSeat: Math.round(PRODUCT_PRICES.bundle * 0.8) },
    { seats: '50+', discount: 25, perSeat: Math.round(PRODUCT_PRICES.bundle * 0.75) },
  ];

  return (
    <>
      <SEOHead
        title="Für Unternehmen & Schulen – ExamFit B2B"
        description="IHK-Prüfungsvorbereitung für Ausbildungsbetriebe, Berufsschulen und Bildungsträger. Automatische Mengenrabatte, keine Vertragsbindung."
        canonical={`${SITE_URL}/unternehmen`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[{ label: 'Unternehmen' }]}
              className="mb-8"
            />

            <div className="max-w-3xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                B2B & Bildung
              </Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">ExamFit</span> für
                <br />
                Unternehmen & Schulen
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Unterstützen Sie Ihre Azubis bei der IHK-Prüfung. 
                Einfach im Shop kaufen – automatische Mengenrabatte, keine Vertragsbindung.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild>
                  <Link to="/shop">
                    Lizenzen kaufen <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to="/preise">Preise ansehen</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Segments */}
        <section className="py-16">
          <div className="container">
            <div className="grid md:grid-cols-3 gap-8">
              {segments.map((segment) => {
                const Icon = segment.icon;
                return (
                  <Card key={segment.id} className="glass-card h-full">
                    <CardHeader>
                      <Icon className="h-10 w-10 text-primary mb-4" />
                      <CardTitle>{segment.title}</CardTitle>
                      <CardDescription>{segment.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 mb-6">
                        {segment.benefits.map((benefit, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-success flex-shrink-0" />
                            {benefit}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="py-16 bg-muted/30">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-display font-bold mb-4">
                Automatische Mengenrabatte
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Je mehr Lizenzen Sie kaufen, desto günstiger wird es. 
                Keine Verhandlung nötig – die Rabatte werden automatisch angewendet.
              </p>
            </div>

            <div className="max-w-4xl mx-auto">
              <Card className="glass-card overflow-hidden">
                <div className="grid grid-cols-3 gap-px bg-border">
                  <div className="bg-muted/50 p-4 font-semibold">
                    <Users className="h-5 w-5 inline mr-2" />
                    Anzahl Lizenzen
                  </div>
                  <div className="bg-muted/50 p-4 font-semibold text-center">
                    Rabatt
                  </div>
                  <div className="bg-muted/50 p-4 font-semibold text-right">
                    Pro Lizenz
                  </div>
                  
                  {pricingTiers.map((tier, i) => (
                    <>
                      <div key={`seats-${i}`} className="bg-card p-4">
                        {tier.seats} Lizenzen
                      </div>
                      <div key={`discount-${i}`} className="bg-card p-4 text-center">
                        {tier.discount > 0 ? (
                          <Badge variant="default" className="bg-success">
                            -{tier.discount}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </div>
                      <div key={`price-${i}`} className="bg-card p-4 text-right font-semibold">
                        {formatEuro(tier.perSeat)}
                      </div>
                    </>
                  ))}
                </div>
              </Card>

              <p className="text-center text-sm text-muted-foreground mt-4">
                Preise für das Prüfungstraining (inkl. Prüfungssimulation + Prüfungswissen + Mündliche Prüfung). 
                Alle Preise netto zzgl. MwSt.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              So einfach funktioniert's
            </h2>
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-primary">1</span>
                </div>
                <h3 className="font-semibold mb-2">Lizenzen kaufen</h3>
                <p className="text-sm text-muted-foreground">
                  Wählen Sie Beruf und Produkt im Shop. Mengenrabatte werden automatisch berechnet.
                </p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-accent">2</span>
                </div>
                <h3 className="font-semibold mb-2">Rechnung erhalten</h3>
                <p className="text-sm text-muted-foreground">
                  Sie erhalten eine ordentliche Rechnung mit ausgewiesener MwSt. für Ihre Buchhaltung.
                </p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-success-bg-subtle flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-success">3</span>
                </div>
                <h3 className="font-semibold mb-2">Codes verteilen</h3>
                <p className="text-sm text-muted-foreground">
                  Sie erhalten Zugangscodes, die Sie an Ihre Azubis weitergeben können.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Bereit loszulegen?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Kaufen Sie direkt im Shop – keine Wartezeit, keine Verhandlung.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to="/shop">
                Jetzt Lizenzen kaufen <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
