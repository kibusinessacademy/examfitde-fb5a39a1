import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, Clock, ExternalLink, CheckCircle, Star, Shield, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useHomepageCatalog } from '@/hooks/usePublishedCourses';
import { getExamTarget } from '@/lib/examTargets';
import { 
  SEO_TEMPLATES, 
  SITE_URL, 
  PRODUCT_PRICES,
  generateCourseSchema,
  generateFAQSchema,
} from '@/lib/seo';

export default function BerufDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: catalog, isLoading } = useHomepageCatalog();
  
  const course = catalog?.find(c => c.slug === slug);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) {
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

  const title = course.berufDisplayName || course.title;
  const kammerLabel = course.kammer || 'IHK';
  const duration = course.ausbildungsdauerMonate || 36;
  const examConfig = getExamTarget(duration);
  const seo = SEO_TEMPLATES.beruf(title, kammerLabel, examConfig.label);
  
  const faqs = [
    {
      question: `Wie lange dauert die Ausbildung ${title}?`,
      answer: `Die Ausbildung dauert in der Regel ${duration} Monate (${Math.round(duration / 12)} Jahre).`,
    },
    {
      question: `Was kostet die ${kammerLabel}-Prüfungsvorbereitung für ${title}?`,
      answer: `Die komplette Prüfungsvorbereitung kostet einmalig ${PRODUCT_PRICES.bundle}€ – inklusive Lernkurs, Prüfungstrainer und mündlicher Prüfungssimulation. 12 Monate Zugang, kein Abo.`,
    },
    {
      question: `Wann findet die ${kammerLabel}-Prüfung für ${title} statt?`,
      answer: `Die ${kammerLabel}-Abschlussprüfung findet deutschlandweit zu einheitlichen Terminen statt. Die genauen Termine werden von deiner zuständigen Kammer bekanntgegeben.`,
    },
    {
      question: `Wie bereite ich mich am besten auf die ${kammerLabel}-Prüfung vor?`,
      answer: `ExamFit bietet eine strukturierte Vorbereitung in einem einzigen Bundle: Du lernst alle Inhalte mit den Lernmodulen, übst mit echten Prüfungsfragen im Prüfungstrainer und simulierst die mündliche Prüfung mit unserem KI-Trainer.`,
    },
  ];

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateCourseSchema({
        id: slug || course.packageId,
        name: `${title} ${kammerLabel}-Prüfungsvorbereitung`,
        description: course.description || seo.description,
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
                { label: title },
              ]}
              className="mb-8"
            />

            <div className="grid lg:grid-cols-3 gap-12">
              <div className="lg:col-span-2">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4">
                  <Star className="h-4 w-4 text-warning fill-warning" />
                  <span className="text-sm text-muted-foreground">98% Bestehensquote</span>
                </div>
                <h1 className="text-responsive-2xl md:text-responsive-3xl lg:text-responsive-4xl font-display font-bold mb-4">
                  {title}
                  <br />
                  <span className="text-gradient">{kammerLabel}-Prüfung bestehen</span>
                </h1>
                {course.berufLang && course.berufLang !== title && (
                  <p className="text-lg text-muted-foreground mb-4">
                    {course.berufLang}
                  </p>
                )}
                <p className="text-xl text-muted-foreground mb-6">
                  {course.description || `Bereite dich optimal auf die ${kammerLabel}-Abschlussprüfung ${title} vor. Strukturierte Lernkurse, prüfungsrelevante Fragen und mündliche Prüfungssimulation.`}
                </p>

                <div className="flex flex-wrap gap-4 mb-8">
                  <Badge 
                    variant="default"
                    className="flex items-center gap-1.5 py-1.5 px-3"
                  >
                    <Building2 className="h-4 w-4" />
                    {kammerLabel}
                  </Badge>
                  {course.ausbildungsdauerMonate && (
                    <Badge variant="outline" className="flex items-center gap-1.5 py-1.5 px-3">
                      <Clock className="h-4 w-4" />
                      {course.ausbildungsdauerMonate} Monate Ausbildung
                    </Badge>
                  )}
                  {course.dqrNiveau && (
                    <Badge variant="outline" className="py-1.5 px-3">
                      DQR-Niveau {course.dqrNiveau}
                    </Badge>
                  )}
                  <Badge variant="outline" className="flex items-center gap-1.5 py-1.5 px-3">
                    <Shield className="h-4 w-4" />
                    {kammerLabel}-Prüfungsstandards
                  </Badge>
                </div>
              </div>

              {/* Produkt-CTA Sidebar — Bundle-only (24,90 €) */}
              <div className="lg:col-span-1">
                <Card className="glass-card sticky top-24">
                  <CardHeader>
                    <CardTitle>Jetzt Prüfung vorbereiten</CardTitle>
                    <CardDescription>
                      Alles in einem Paket — Lernkurs, Prüfungstrainer & mündliche Simulation
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Link to={`/bundle/${slug}`} className="block">
                      <div className="p-5 rounded-lg border-2 border-primary bg-primary/5 hover:bg-primary/10 transition-colors">
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-success" />
                            <span className="font-semibold">Komplett-Bundle</span>
                          </div>
                          <span className="font-bold text-2xl">{PRODUCT_PRICES.bundle}€</span>
                        </div>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                            <span>Strukturierter Lernkurs nach Rahmenplan</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                            <span>Prüfungstrainer mit echten IHK-Fragen</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                            <span>KI-gestützte mündliche Prüfungssimulation</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                            <span>12 Monate Zugang, einmalig zahlen</span>
                          </li>
                        </ul>
                        <Button className="w-full mt-4" size="sm">
                          Jetzt für {PRODUCT_PRICES.bundle}€ starten
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Warum ExamFit */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-responsive-xl md:text-responsive-2xl font-display font-bold mb-8 text-center">
              Warum ExamFit für <span className="text-gradient">{title}</span> ({kammerLabel})?
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <div className="text-4xl mb-4">🎯</div>
                  <h3 className="font-semibold mb-2">Prüfungsorientiert</h3>
                  <p className="text-sm text-muted-foreground">
                    Alle Inhalte sind auf die {kammerLabel}-Prüfung abgestimmt – kein Ballast.
                  </p>
                </CardContent>
              </Card>
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <div className="text-4xl mb-4">🧠</div>
                  <h3 className="font-semibold mb-2">Adaptiv</h3>
                  <p className="text-sm text-muted-foreground">
                    Das System erkennt deine Schwächen und trainiert gezielt.
                  </p>
                </CardContent>
              </Card>
              <Card className="glass-card text-center">
                <CardContent className="pt-6">
                  <div className="text-4xl mb-4">🎤</div>
                  <h3 className="font-semibold mb-2">Mündlich üben</h3>
                  <p className="text-sm text-muted-foreground">
                    Simuliere das Fachgespräch mit KI-Feedback.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-responsive-xl md:text-responsive-2xl font-display font-bold mb-8 text-center">
              Häufige Fragen zur {title} {kammerLabel}-Prüfung
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
            <h2 className="text-responsive-xl md:text-responsive-2xl lg:text-responsive-3xl font-display font-bold mb-6">
              Bereit für die {title} {kammerLabel}-Prüfung?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Starte jetzt mit dem Komplett-Bundle und spare {PRODUCT_PRICES.lernkurs + PRODUCT_PRICES.pruefungstrainer - PRODUCT_PRICES.bundle}€.
              Einmalzahlung, 12 Monate Zugang.
            </p>
            <Button size="lg" className="shadow-glow" asChild>
              <Link to={`/bundle/${slug}`}>
                Jetzt Prüfung vorbereiten <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
