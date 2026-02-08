import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award } from 'lucide-react';
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
    title: 'Lernkurse',
    subtitle: 'Interaktive H5P-Module für alle Lernfelder',
    description: 'Strukturierte Lernkurse für alle IHK-Ausbildungsberufe.',
    icon: BookOpen,
    color: 'primary',
    price: PRODUCT_PRICES.lernkurs,
    features: ['Alle Lernfelder', 'H5P-Module', 'KI-Tutor', '12 Monate'],
    urlPrefix: '/lernkurse',
  },
  pruefungstrainer: {
    title: 'Prüfungstrainer',
    subtitle: 'Echte IHK-Prüfungsfragen üben',
    description: 'Prüfungstrainer für alle IHK-Ausbildungsberufe.',
    icon: Target,
    color: 'accent',
    price: PRODUCT_PRICES.pruefungstrainer,
    features: ['IHK-Fragen', 'Adaptiv', 'Simulation', '12 Monate'],
    urlPrefix: '/pruefungstrainer',
  },
  bundle: {
    title: 'Komplett-Bundles',
    subtitle: 'Lernen + Üben + Mündliche Prüfung',
    description: 'Das Komplett-Paket für alle IHK-Ausbildungsberufe.',
    icon: Award,
    color: 'success',
    price: PRODUCT_PRICES.bundle,
    features: ['Alles inkl.', 'Mündlich', 'KI-Prüfer', '12 Monate'],
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
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                {config.title}
              </Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                <span className="text-gradient">{config.title}</span>
                <br />für alle IHK-Berufe
              </h1>
              <p className="text-xl text-muted-foreground mb-8">{config.subtitle}</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold">{config.price}€</span>
                <span className="text-muted-foreground mb-1">pro Beruf</span>
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
                        <span className="text-sm text-primary flex items-center">
                          Jetzt ansehen <ArrowRight className="ml-1 h-4 w-4" />
                        </span>
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
              </p>
              <Button asChild>
                <Link to="/bundle">Bundles entdecken <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </section>
        )}
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
