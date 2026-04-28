import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle, Clock, Mic, Star, Shield, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSingleBeruf, useCurriculumProductBySlug } from '@/hooks/useSEOPages';
import { SEO_TEMPLATES, SITE_URL, PRODUCT_PRICES, generateProductSchema } from '@/lib/seo';

// Bundle-only Strategie: Es gibt nur ein kaufbares Produkt — das Bundle (24,90 €).
// Legacy-Routen (/lernkurse, /pruefungstrainer) werden via LegacyProductRedirect auf
// /bundle/:slug umgeleitet — siehe AppRoutes.tsx und LegacyProductRedirect.tsx.
type ProductType = 'bundle';

const productInfo = {
  bundle: {
    icon: Award,
    color: 'success',
    features: [
      'Lernkurs nach Rahmenplan',
      'Prüfungstrainer mit echten IHK-Fragen',
      'Mündliche Prüfungssimulation',
      'KI-Tutor mit Echtzeit-Feedback',
      'Prüfungsangst-Management',
      '12 Monate unbegrenzter Zugang',
    ],
    benefits: [
      'Komplett-Paket für maximale Sicherheit',
      'Mündliche Prüfung perfekt vorbereitet',
      'Einmalzahlung, kein Abo',
    ],
    cta: 'Bundle kaufen',
    label: 'Komplett-Bundle',
    listLabel: 'Bundles',
  },
} as const;

interface ProductDetailPageProps {
  productType: ProductType;
}

function ProductDetailPageComponent({ productType }: ProductDetailPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const beruf = useSingleBeruf(slug || '');
  // Bundle-only Strategie: Alle Produkt-URLs werden auf 'bundle' normalisiert.
  const effectiveType = 'bundle' as const;
  const product = useCurriculumProductBySlug(slug || '', effectiveType);

  if (!beruf) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Produkt nicht gefunden</h1>
          <Button asChild><Link to="/berufe">Alle Berufe anzeigen</Link></Button>
        </div>
      </div>
    );
  }

  const seo = SEO_TEMPLATES[effectiveType](beruf.title);
  const price = PRODUCT_PRICES[effectiveType];
  const info = productInfo[effectiveType];
  const Icon = info.icon;

  const structuredData = generateProductSchema({
    name: `${beruf.title} ${info.label}`,
    description: seo.description,
    price,
    url: `${SITE_URL}/bundle/${slug}`,
    sku: `bundle-${slug}`,
    ratingValue: 4.9,
    reviewCount: 127,
  });

  return (
    <>
      <SEOHead
        title={product?.seo_title || seo.title}
        description={product?.seo_description || seo.description}
        canonical={`${SITE_URL}/bundle/${slug}`}
        type="product"
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[
                { label: info.listLabel, href: '/bundle' },
                { label: beruf.title },
              ]}
              className="mb-8"
            />

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4">
                  <Star className="h-4 w-4 text-warning fill-warning" />
                  <span className="text-sm text-muted-foreground">98% Bestehensquote</span>
                </div>
                <Badge className="mb-4 ml-2 bg-primary/20 text-primary border-primary/30">{info.label}</Badge>
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                  {beruf.title}<br />
                  <span className="text-gradient">{info.label}</span>
                </h1>
                <p className="text-xl text-muted-foreground mb-8">{seo.description}</p>

                <div className="flex items-end gap-4 mb-6">
                  <span className="text-5xl font-bold">{price}€</span>
                  <span className="text-base text-muted-foreground mb-2">einmalig · 12 Monate Zugang</span>
                </div>
                
                <div className="flex flex-wrap gap-3 mb-8">
                  <Badge variant="outline" className="py-1.5 px-3">
                    <Clock className="h-3 w-3 mr-1" />12 Monate Zugang
                  </Badge>
                  <Badge variant="outline" className="py-1.5 px-3">
                    <Shield className="h-3 w-3 mr-1" />Einmalzahlung
                  </Badge>
                  <Badge variant="outline" className="py-1.5 px-3">
                    <CheckCircle className="h-3 w-3 mr-1" />Sofortiger Zugang
                  </Badge>
                </div>

                <Button size="lg" className="shadow-glow" asChild>
                  <Link to="/shop">{info.cta} <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
              </div>

              <Card className="glass-card">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-primary/20">
                      <Icon className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <CardTitle>Das ist enthalten</CardTitle>
                      <CardDescription>Alles für deinen Prüfungserfolg</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-4">
                    {info.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Deine Vorteile mit dem <span className="text-gradient">{info.label}</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {info.benefits.map((benefit, index) => (
                <Card key={index} className="glass-card text-center">
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="h-6 w-6 text-primary" />
                    </div>
                    <p className="font-medium">{benefit}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Why ExamFit */}
        <section className="py-16">
          <div className="container">
            <h2 className="text-3xl font-display font-bold text-center mb-12">Warum ExamFit?</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <Brain className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Adaptives Lernen</h3>
                  <p className="text-sm text-muted-foreground">
                    Das System erkennt deine Schwächen und trainiert gezielt.
                  </p>
                </CardContent>
              </Card>
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <Shield className="h-10 w-10 text-accent mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">IHK-konform</h3>
                  <p className="text-sm text-muted-foreground">
                    Alle Inhalte basieren auf offiziellen Rahmenlehrplänen.
                  </p>
                </CardContent>
              </Card>
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <Mic className="h-10 w-10 text-success mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">Mündliche Prüfung</h3>
                  <p className="text-sm text-muted-foreground">
                    Übe das Fachgespräch mit KI-Feedback (im Bundle).
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Bundle-only Strategie: Cross-Sell-Block entfernt — es gibt keine Einzelprodukte mehr. */}

        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">Starte jetzt deine Prüfungsvorbereitung</h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Einmalzahlung, 12 Monate unbegrenzter Zugang. Kein Abo, keine versteckten Kosten.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to="/shop">Jetzt kaufen <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

// Bundle-only: Es gibt nur noch einen kaufbaren Produkt-Detail-Export.
// Legacy-Named-Exports wurden entfernt — alle Legacy-Routen werden in AppRoutes.tsx
// über LegacyProductRedirect direkt auf /bundle/:slug umgeleitet, ohne diese Komponente
// jemals zu rendern.
export function BundleDetailPage() {
  return <ProductDetailPageComponent productType="bundle" />;
}

export default ProductDetailPageComponent;
