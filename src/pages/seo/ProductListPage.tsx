import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle, Star, Shield, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useBerufPages } from '@/hooks/useSEOPages';
import { SITE_URL, PRODUCT_PRICES } from '@/lib/seo';

/**
 * Single-product strategy: All product list pages redirect to one unified product page.
 * The old 3-tier model (lernkurs, pruefungstrainer, bundle) is consolidated.
 */

function ProductListPageComponent() {
  const { data: berufe, isLoading } = useBerufPages();

  return (
    <>
      <SEOHead
        title="Intelligentes Prüfungstraining – IHK-Prüfungsvorbereitung | ExamFit"
        description="ExamFit Prüfungstraining für alle IHK-Ausbildungsberufe. Prüfungssimulation, KI-Coach, mündliche Prüfung – alles in einem Produkt für 24,90 €."
        canonical={`${SITE_URL}/pruefungstraining`}
        type="product"
      />

      <div className="min-h-screen">
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'Prüfungstraining' }]} className="mb-8" />

            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4">
                <Star className="h-4 w-4 text-warning fill-warning" />
                <span className="text-sm text-muted-foreground">98% Bestehensquote</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                <span className="text-gradient">Intelligentes Prüfungstraining</span>
                <br />für alle IHK-Berufe
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Alles in einem Produkt: Prüfungssimulation, KI-Coach, mündliche Prüfung & Prüfungswissen.
              </p>
              <div className="flex items-end gap-3 mb-6">
                <span className="text-4xl font-bold text-gradient">{PRODUCT_PRICES.pruefungstraining} €</span>
                <span className="text-muted-foreground mb-1">einmalig · 12 Monate</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline" className="py-1.5 px-3">
                  <Clock className="h-3 w-3 mr-1" />12 Monate Zugang
                </Badge>
                <Badge variant="outline" className="py-1.5 px-3">
                  <Shield className="h-3 w-3 mr-1" />Einmalzahlung
                </Badge>
                <Badge variant="outline" className="py-1.5 px-3">
                  <CheckCircle className="h-3 w-3 mr-1" />Alles inklusive
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
                  <Link key={beruf.id} to={`/shop?beruf=${beruf.slug}`}>
                    <Card className="glass-card hover:shadow-glow-sm transition-all h-full group">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <Target className="h-6 w-6 text-primary" />
                          <span className="font-bold text-gradient">{PRODUCT_PRICES.pruefungstraining} €</span>
                        </div>
                        <CardTitle className="group-hover:text-primary transition-colors">
                          {beruf.title}
                        </CardTitle>
                        <CardDescription>Prüfungstraining für die IHK-Prüfung</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs">Alles inklusive</Badge>
                          <Badge variant="outline" className="text-xs">12 Monate</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Bereit für die Abschlussprüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Einmalzahlung, 12 Monate Zugang. Kein Abo, keine versteckten Kosten.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
              <Link to="/shop">Zum Prüfungstraining <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

// All old product type routes now use the unified page
export function LernkurseListPage() {
  return <Navigate to="/pruefungstraining" replace />;
}

export function PruefungstrainerListPage() {
  return <Navigate to="/pruefungstraining" replace />;
}

export function BundleListPage() {
  return <Navigate to="/pruefungstraining" replace />;
}

export default ProductListPageComponent;
