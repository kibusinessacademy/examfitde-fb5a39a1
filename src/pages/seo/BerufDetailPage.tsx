import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, Clock, ExternalLink, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSingleBeruf } from '@/hooks/useSEOPages';
import { 
  SEO_TEMPLATES, 
  SITE_URL, 
  PRODUCT_PRICES,
  generateCourseSchema,
  generateFAQSchema,
} from '@/lib/seo';

export default function BerufDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const beruf = useSingleBeruf(slug || '');

  if (!beruf) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Beruf nicht gefunden</h1>
          <Button asChild>
            <Link to="/berufe">Alle Berufe anzeigen</Link>
          </Button>
        </div>
      </div>
    );
  }

  const seo = SEO_TEMPLATES.beruf(beruf.title);
  
  const faqs = [
    {
      question: `Wie lange dauert die Ausbildung ${beruf.title}?`,
      answer: `Die Ausbildung dauert in der Regel ${beruf.duration} Monate (${Math.round(beruf.duration / 12)} Jahre).`,
    },
    {
      question: `Was kostet die IHK-Prüfungsvorbereitung für ${beruf.title}?`,
      answer: `Der Lernkurs kostet ${PRODUCT_PRICES.lernkurs}€, der Prüfungstrainer ${PRODUCT_PRICES.pruefungstrainer}€. Das Komplett-Bundle gibt es für nur ${PRODUCT_PRICES.bundle}€ – du sparst also ${PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer - PRODUCT_PRICES.bundle}€.`,
    },
    {
      question: `Wann findet die IHK-Prüfung für ${beruf.title} statt?`,
      answer: `Die IHK-Abschlussprüfung findet deutschlandweit zu einheitlichen Terminen statt. Die genauen Termine werden von deiner zuständigen IHK bekanntgegeben.`,
    },
    {
      question: `Wie bereite ich mich am besten auf die IHK-Prüfung vor?`,
      answer: `ExamFit bietet eine strukturierte Vorbereitung: Erst lernst du mit dem Lernkurs alle Inhalte, dann übst du mit dem Prüfungstrainer echte Prüfungsfragen, und schließlich simulierst du die mündliche Prüfung mit unserem KI-Trainer.`,
    },
  ];

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateCourseSchema({
        id: slug || beruf.id,
        name: `${beruf.title} IHK-Prüfungsvorbereitung`,
        description: beruf.description || seo.description,
        url: `${SITE_URL}/berufe/${slug}`,
        price: PRODUCT_PRICES.bundle,
      }),
      generateFAQSchema(faqs),
    ],
  };

  return (
    <>
      <SEOHead
        title={seo.title}
        description={seo.description}
        canonical={`${SITE_URL}/berufe/${slug}`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[
                { label: 'Berufe', href: '/berufe' },
                { label: beruf.title },
              ]}
              className="mb-8"
            />

            <div className="grid lg:grid-cols-3 gap-12">
              <div className="lg:col-span-2">
                <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                  Ausbildungsberuf
                </Badge>
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
                  {beruf.title}
                </h1>
                {beruf.fullTitle !== beruf.title && (
                  <p className="text-lg text-muted-foreground mb-4">
                    {beruf.fullTitle}
                  </p>
                )}
                <p className="text-xl text-muted-foreground mb-6">
                  {beruf.description || `Bereite dich optimal auf die IHK-Abschlussprüfung vor.`}
                </p>

                <div className="flex flex-wrap gap-4 mb-8">
                  <Badge variant="outline" className="flex items-center gap-1.5 py-1.5 px-3">
                    <Clock className="h-4 w-4" />
                    {beruf.duration} Monate Ausbildung
                  </Badge>
                  {beruf.dqrLevel && (
                    <Badge variant="outline" className="py-1.5 px-3">
                      DQR-Niveau {beruf.dqrLevel}
                    </Badge>
                  )}
                </div>

                {beruf.bibbUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={beruf.bibbUrl} target="_blank" rel="noopener noreferrer">
                      BIBB-Profil <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>

              {/* Produkt-CTA Sidebar */}
              <div className="lg:col-span-1">
                <Card className="glass-card sticky top-24">
                  <CardHeader>
                    <CardTitle>Jetzt vorbereiten</CardTitle>
                    <CardDescription>
                      Wähle dein Produkt und starte sofort
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Link to={`/lernkurse/${slug}`} className="block">
                      <div className="p-4 rounded-lg border border-border hover:border-primary/50 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <BookOpen className="h-5 w-5 text-primary" />
                            <span className="font-semibold">Lernkurs</span>
                          </div>
                          <span className="font-bold">{PRODUCT_PRICES.lernkurs}€</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Interaktive H5P-Module zu allen Lernfeldern
                        </p>
                      </div>
                    </Link>

                    <Link to={`/pruefungstrainer/${slug}`} className="block">
                      <div className="p-4 rounded-lg border border-border hover:border-primary/50 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-5 w-5 text-accent" />
                            <span className="font-semibold">Prüfungstrainer</span>
                          </div>
                          <span className="font-bold">{PRODUCT_PRICES.pruefungstrainer}€</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Echte IHK-Prüfungsfragen üben
                        </p>
                      </div>
                    </Link>

                    <Link to={`/bundle/${slug}`} className="block">
                      <div className="p-4 rounded-lg border-2 border-primary bg-primary/5 hover:bg-primary/10 transition-colors relative">
                        <Badge className="absolute -top-2 right-2 bg-primary">
                          Empfohlen
                        </Badge>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-success" />
                            <span className="font-semibold">Komplett-Bundle</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-lg">{PRODUCT_PRICES.bundle}€</span>
                            <div className="text-xs text-muted-foreground line-through">
                              {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer}€
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Alles in einem: Lernen + Üben + Mündliche Prüfung
                        </p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8 text-center">
              Häufige Fragen
            </h2>
            <div className="space-y-6">
              {faqs.map((faq, index) => (
                <Card key={index} className="glass-card">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      {faq.question}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pl-11">
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
              Bereit für die IHK-Prüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Starte jetzt mit dem Komplett-Bundle und spare {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer - PRODUCT_PRICES.bundle}€.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to={`/bundle/${slug}`}>
                Jetzt starten <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
