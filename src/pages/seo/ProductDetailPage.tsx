import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle, Clock, Layers, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSingleBeruf, useCurriculumProductBySlug } from '@/hooks/useSEOPages';
import { SEO_TEMPLATES, SITE_URL, PRODUCT_PRICES, generateProductSchema } from '@/lib/seo';

type ProductType = 'lernkurs' | 'pruefungstrainer' | 'bundle';

const productInfo: Record<ProductType, {
  icon: typeof BookOpen;
  color: string;
  features: string[];
  cta: string;
  label: string;
  listLabel: string;
}> = {
  lernkurs: {
    icon: BookOpen,
    color: 'primary',
    features: [
      'Alle Lernfelder strukturiert aufbereitet',
      'Interaktive H5P-Module',
      'KI-Tutor für Fragen',
      'Fortschrittstracking',
      '12 Monate Zugang',
    ],
    cta: 'Lernkurs kaufen',
    label: 'Lernkurs',
    listLabel: 'Lernkurse',
  },
  pruefungstrainer: {
    icon: Target,
    color: 'accent',
    features: [
      'Echte IHK-Prüfungsfragen',
      'Adaptiver Lernalgorithmus',
      'Schwachstellen-Analyse',
      'Prüfungssimulation',
      '12 Monate Zugang',
    ],
    cta: 'Prüfungstrainer kaufen',
    label: 'Prüfungstrainer',
    listLabel: 'Prüfungstrainer',
  },
  bundle: {
    icon: Award,
    color: 'success',
    features: [
      'Lernkurs + Prüfungstrainer',
      'Mündliche Prüfungssimulation',
      'KI-Prüfer mit Echtzeit-Feedback',
      'Prüfungsangst-Management',
      '12 Monate Zugang',
    ],
    cta: 'Bundle kaufen',
    label: 'Komplett-Bundle',
    listLabel: 'Bundles',
  },
};

interface ProductDetailPageProps {
  productType: ProductType;
}

function ProductDetailPageComponent({ productType }: ProductDetailPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const beruf = useSingleBeruf(slug || '');
  const product = useCurriculumProductBySlug(slug || '', productType);

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

  const seo = SEO_TEMPLATES[productType](beruf.title);
  const price = PRODUCT_PRICES[productType];
  const info = productInfo[productType];
  const Icon = info.icon;

  const structuredData = generateProductSchema({
    name: `${beruf.title} ${info.label}`,
    description: seo.description,
    price,
    url: `${SITE_URL}/${productType}/${slug}`,
    sku: `${productType}-${slug}`,
  });

  return (
    <>
      <SEOHead
        title={product?.seo_title || seo.title}
        description={product?.seo_description || seo.description}
        canonical={`${SITE_URL}/${productType}/${slug}`}
        type="product"
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[
                { label: info.listLabel, href: `/${productType === 'bundle' ? 'bundle' : productType + 's'}` },
                { label: beruf.title },
              ]}
              className="mb-8"
            />

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">{info.label}</Badge>
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                  {beruf.title}<br />
                  <span className="text-gradient">{info.label}</span>
                </h1>
                <p className="text-xl text-muted-foreground mb-8">{seo.description}</p>

                <div className="flex items-end gap-4 mb-8">
                  <span className="text-5xl font-bold">{price}€</span>
                  {productType === 'bundle' && (
                    <span className="text-lg text-muted-foreground line-through mb-1">
                      {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer}€
                    </span>
                  )}
                  <Badge variant="outline" className="mb-2">
                    <Clock className="h-3 w-3 mr-1" />12 Monate Zugang
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

        <section className="py-16 bg-muted/30">
          <div className="container">
            <h2 className="text-3xl font-display font-bold text-center mb-12">Warum ExamFit?</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { num: 1, title: 'Curriculumsbasiert', text: 'Alle Inhalte basieren auf dem offiziellen IHK-Rahmenlehrplan.' },
                { num: 2, title: 'KI-gestützt', text: 'Adaptive Algorithmen erkennen deine Schwächen und trainieren gezielt.' },
                { num: 3, title: 'Prüfungsnah', text: 'Echte Prüfungsfragen und mündliche Simulation bereiten dich optimal vor.' },
              ].map((item) => (
                <Card key={item.num} className="glass-card text-center">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl font-bold text-primary">{item.num}</span>
                    </div>
                    <CardTitle>{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{item.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {productType !== 'bundle' && (
          <section className="py-16">
            <div className="container max-w-3xl text-center">
              <Badge variant="outline" className="mb-4">Tipp</Badge>
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
                Spare {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer - PRODUCT_PRICES.bundle}€ mit dem Bundle
              </h2>
              <p className="text-muted-foreground mb-6">
                Hol dir Lernkurs + Prüfungstrainer + mündliche Prüfungssimulation in einem Paket.
              </p>
              <Button size="lg" variant="outline" asChild>
                <Link to={`/bundle/${slug}`}>Zum Bundle <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </section>
        )}

        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">Starte jetzt deine Vorbereitung</h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Sofortiger Zugang nach dem Kauf. Kein Abo – einmal zahlen, 12 Monate lernen.
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

// Named exports
export function LernkursDetailPage() {
  return <ProductDetailPageComponent productType="lernkurs" />;
}

export function PruefungstrainerDetailPage() {
  return <ProductDetailPageComponent productType="pruefungstrainer" />;
}

export function BundleDetailPage() {
  return <ProductDetailPageComponent productType="bundle" />;
}

export default ProductDetailPageComponent;
