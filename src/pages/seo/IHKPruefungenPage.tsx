import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useBerufPages } from '@/hooks/useSEOPages';
import { generateOrganizationSchema, SITE_URL, getBerufUrl, getIHKPruefungUrl } from '@/lib/seo';

export default function IHKPruefungenPage() {
  const { data: berufe, isLoading } = useBerufPages();

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'WebPage',
        name: 'IHK-Prüfung bestehen – Vorbereitung & Training',
        description: 'Bereite dich optimal auf deine IHK-Prüfung vor. Interaktive Lernkurse, Prüfungstrainer und mündliche Prüfungssimulation für alle Ausbildungsberufe.',
        url: `${SITE_URL}/ihk-pruefungen`,
      },
    ],
  };

  return (
    <>
      <SEOHead
        title="IHK-Prüfung bestehen – Vorbereitung & Training | ExamFit"
        description="Bereite dich optimal auf deine IHK-Prüfung vor. Interaktive Lernkurse, Prüfungstrainer und mündliche Prüfungssimulation für alle Ausbildungsberufe."
        canonical={`${SITE_URL}/ihk-pruefungen`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="relative py-20 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[{ label: 'IHK-Prüfungen' }]}
              className="mb-8"
            />

            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                IHK-Prüfungsvorbereitung
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Prüfung bestehen</span>
                <br />
                mit KI-gestütztem Training
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Bereite dich optimal auf deine Abschlussprüfung vor. Strukturierte Lernkurse, 
                prüfungsrelevante Fragen und mündliche Prüfungssimulation – alles in einer Plattform.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild>
                  <Link to="/shop">
                    Jetzt starten <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to="/berufe">Berufe entdecken</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-16 bg-muted/30">
          <div className="container">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              So unterstützt dich ExamFit
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="glass-card">
                <CardHeader>
                  <BookOpen className="h-10 w-10 text-primary mb-4" />
                  <CardTitle>Strukturiertes Lernen</CardTitle>
                  <CardDescription>
                    Interaktive H5P-Module zu allen Lernfeldern deines Ausbildungsberufs
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <Target className="h-10 w-10 text-accent mb-4" />
                  <CardTitle>Gezieltes Üben</CardTitle>
                  <CardDescription>
                    Prüfungsfragen mit adaptivem Algorithmus, der deine Schwächen erkennt
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <Award className="h-10 w-10 text-success mb-4" />
                  <CardTitle>Mündliche Prüfung</CardTitle>
                  <CardDescription>
                    KI-Prüfungssimulation mit Echtzeit-Feedback zu deinen Antworten
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Berufe Grid */}
        <section className="py-16">
          <div className="container">
            <h2 className="text-3xl font-display font-bold mb-4">
              Wähle deinen Ausbildungsberuf
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl">
              Wir bieten Prüfungsvorbereitung für alle IHK-Ausbildungsberufe. 
              Finde deinen Beruf und starte sofort mit dem Lernen.
            </p>

            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="glass-card animate-pulse">
                    <CardHeader>
                      <div className="h-6 bg-muted rounded w-3/4" />
                      <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {berufe?.slice(0, 12).map((beruf) => (
                  <Link key={beruf.id} to={getIHKPruefungUrl(beruf.slug)}>
                    <Card className="glass-card hover:shadow-glow-sm transition-all duration-300 h-full">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                          {beruf.title}
                        </CardTitle>
                        <CardDescription className="line-clamp-2">
                          {beruf.description || `IHK-Prüfungsvorbereitung für ${beruf.title}`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <Badge variant="outline">
                            {beruf.duration} Monate
                          </Badge>
                          <span className="text-sm text-primary flex items-center">
                            Zur Vorbereitung <ArrowRight className="ml-1 h-4 w-4" />
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}

            {berufe && berufe.length > 12 && (
              <div className="text-center mt-8">
                <Button variant="outline" size="lg" asChild>
                  <Link to="/berufe">
                    Alle {berufe.length} Berufe anzeigen
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
              Bereit für deine IHK-Prüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Starte jetzt mit der Vorbereitung und sichere dir den Prüfungserfolg.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to="/shop">
                Jetzt Produkt wählen <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
