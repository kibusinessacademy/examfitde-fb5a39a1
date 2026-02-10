import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle, Star, Shield, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useBerufPages } from '@/hooks/useSEOPages';
import { SITE_URL, PRODUCT_PRICES } from '@/lib/seo';

type ProductType = 'lernkurs' | 'pruefungstrainer' | 'bundle';

const productConfig: Record<ProductType, {
  title: string;
  subtitle: string;
  description: string;
  icon: typeof BookOpen;
  color: string;
  price: number;
  features: string[];
  urlPrefix: string;
}> = {
  lernkurs: {
    title: 'Prüfungswissen',
    subtitle: 'Prüfungsrelevantes Wissen für deinen Beruf',
    description: 'Prüfungsrelevantes Wissen für alle IHK-Ausbildungsberufe. Gezielt aufbereitet für die Abschlussprüfung.',
    icon: BookOpen,
    color: 'primary',
    price: PRODUCT_PRICES.lernkurs,
    features: ['Alle Lernfelder', 'Prüfungsfokus', 'KI-Prüfungscoach', '12 Monate'],
    urlPrefix: '/lernkurse',
  },
  pruefungstrainer: {
    title: 'Prüfungssimulation',
    subtitle: 'Trainiere unter realen Prüfungsbedingungen',
    description: 'Prüfungssimulation für alle IHK-Ausbildungsberufe. Lerne aus deinen Fehlern mit ausführlichen Erklärungen.',
    icon: Target,
    color: 'accent',
    price: PRODUCT_PRICES.pruefungstrainer,
    features: ['IHK-konforme Aufgaben', 'Schwächenanalyse', 'Simulation', '12 Monate'],
    urlPrefix: '/pruefungstrainer',
  },
  bundle: {
    title: 'Prüfungstraining komplett',
    subtitle: 'Prüfungswissen + Simulation + mündliche Prüfung',
    description: 'Das komplette Prüfungstraining für alle IHK-Ausbildungsberufe. Maximale Prüfungssicherheit.',
    icon: Award,
    color: 'success',
    price: PRODUCT_PRICES.bundle,
    features: ['Alles inklusive', 'Mündliche Prüfung', 'KI-Prüfungscoach', '12 Monate'],
    urlPrefix: '/bundle',
  },
};

interface ProductListPageProps {
  productType: ProductType;
}

function ProductListPageComponent({ productType }: ProductListPageProps) {
  const { data: berufe, isLoading } = useBerufPages();
  const config = productConfig[productType];
  const Icon = config.icon;

  return (
    <>
      <SEOHead
        title={`${config.title} – IHK-Prüfungsvorbereitung | ExamFit`}
        description={config.description}
        canonical={`${SITE_URL}${config.urlPrefix}`}
        type="product"
      />

      <div className="min-h-screen">
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: config.title }]} className="mb-8" />

            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4">
                <Star className="h-4 w-4 text-warning fill-warning" />
                <span className="text-sm text-muted-foreground">98% Bestehensquote</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                <span className="text-gradient">{config.title}</span>
                <br />für alle IHK-Berufe
              </h1>
              <p className="text-xl text-muted-foreground mb-8">{config.subtitle}</p>
              <div className="flex items-end gap-3 mb-6">
                <span className="text-4xl font-bold">{config.price}€</span>
                <span className="text-muted-foreground mb-1">pro Beruf</span>
                {productType === 'bundle' && (
                  <Badge className="mb-1 bg-success text-success-foreground">Spare 9€</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline" className="py-1.5 px-3">
                  <Clock className="h-3 w-3 mr-1" />12 Monate Zugang
                </Badge>
                <Badge variant="outline" className="py-1.5 px-3">
                  <Shield className="h-3 w-3 mr-1" />Einmalzahlung
                </Badge>
                <Badge variant="outline" className="py-1.5 px-3">
                  <CheckCircle className="h-3 w-3 mr-1" />IHK-konform
                </Badge>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container">
            <h2 className="text-2xl font-display font-bold mb-6">Wähle deinen Ausbildungsberuf</h2>

            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="glass-card animate-pulse">
                    <CardHeader><div className="h-6 bg-muted rounded w-3/4" /></CardHeader>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {berufe?.map((beruf) => (
                  <Link key={beruf.id} to={`${config.urlPrefix}/${beruf.slug}`}>
                    <Card className="glass-card hover:shadow-glow-sm transition-all h-full group">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <Icon className="h-6 w-6 text-primary" />
                          <span className="font-bold">{config.price}€</span>
                        </div>
                        <CardTitle className="group-hover:text-primary transition-colors">
                          {beruf.title}
                        </CardTitle>
                        <CardDescription>{config.title} für die IHK-Prüfung</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-2">
                            {config.features.slice(0, 2).map((f, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{f}</Badge>
                            ))}
                          </div>
                          <span className="text-sm text-primary flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <ArrowRight className="h-4 w-4" />
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {productType !== 'bundle' && (
          <section className="py-16 bg-muted/30">
            <div className="container max-w-3xl text-center">
              <Badge variant="outline" className="mb-4">Empfehlung</Badge>
              <h2 className="text-2xl font-display font-bold mb-4">Spare mit dem Komplett-Bundle</h2>
              <p className="text-muted-foreground mb-6">
                Lernkurs + Prüfungstrainer + mündliche Prüfungssimulation für nur {PRODUCT_PRICES.bundle}€.
                Du sparst {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer - PRODUCT_PRICES.bundle}€!
              </p>
              <Button asChild>
                <Link to="/bundle">Bundles entdecken <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Starte deine Prüfungsvorbereitung
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Einmalzahlung, 12 Monate Zugang. Kein Abo, keine versteckten Kosten.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to="/shop">Zum Shop <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

// Named exports for each product type
export function LernkurseListPage() {
  return <ProductListPageComponent productType="lernkurs" />;
}

export function PruefungstrainerListPage() {
  return <ProductListPageComponent productType="pruefungstrainer" />;
}

export function BundleListPage() {
  return <ProductListPageComponent productType="bundle" />;
}

export default ProductListPageComponent;
