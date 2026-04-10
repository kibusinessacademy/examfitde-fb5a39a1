import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Target, Award, CheckCircle, Building2, Users, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useBerufPages } from '@/hooks/useSEOPages';
import { generateOrganizationSchema, generateBreadcrumbSchema, generateFAQSchema, SITE_URL, getIHKPruefungUrl } from '@/lib/seo';

const FAQS = [
  { question: 'Welche IHK-Prüfungen deckt ExamFit ab?', answer: 'ExamFit bietet Prüfungstraining für über 200 IHK-Ausbildungsberufe, von Industriekaufmann über Fachinformatiker bis Mechatroniker. Alle Inhalte orientieren sich am Ausbildungsrahmenplan.' },
  { question: 'Ist ExamFit auch für HWK-Prüfungen geeignet?', answer: 'Ja. ExamFit deckt sowohl IHK- als auch HWK-Ausbildungsberufe ab. Die Inhalte sind jeweils auf die prüfungsrelevanten Anforderungen der zuständigen Kammer abgestimmt.' },
  { question: 'Wie unterscheidet sich ExamFit von alten Prüfungen?', answer: 'ExamFit ist kein Fragenkatalog. Es ist ein adaptives Trainingssystem mit Prüfungssimulation, KI-Fehleranalyse und Bestehenswahrscheinlichkeit – auf Basis psychometrischer Modelle.' },
  { question: 'Gibt es auch Teamlizenzen für Betriebe?', answer: 'Ja! Betriebe kaufen Plätze statt Kurse. Eine Ausbildungslizenz deckt alle Berufe ab – ab 29,80 €/Platz pro Jahr. Ideal für gemischte Teams.' },
  { question: 'Ist ExamFit DSGVO-konform?', answer: 'Ja. Alle Daten werden auf EU-Servern gespeichert. ExamFit erfüllt die DSGVO vollständig: Datenminimierung, Löschrechte und technische Sicherheitsmaßnahmen sind implementiert.' },
  { question: 'Wie setzt ExamFit KI ein?', answer: 'KI unterstützt bei Fehleranalyse, adaptivem Training und Bestehenswahrscheinlichkeit. Alle Prüfungsinhalte werden vor Freigabe durch ein mehrstufiges Qualitätssystem geprüft.' },
];

export default function IHKPruefungenPage() {
  const { data: berufe, isLoading } = useBerufPages();

  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'IHK-Prüfungen' },
  ];

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema(FAQS),
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title="IHK-Prüfung bestehen – Prüfungstraining mit Simulation & KI-Coach | ExamFit"
        description="Bereite dich optimal auf deine IHK-Prüfung vor: Prüfungssimulation, adaptive Schwächenanalyse, KI-Prüfungscoach und Bestehenswahrscheinlichkeit für alle Ausbildungsberufe."
        canonical={`${SITE_URL}/ihk-pruefungen`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'IHK-Prüfungen' }]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                IHK &amp; HWK Prüfungsvorbereitung
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Prüfung bestehen</span>
                <br />
                mit adaptivem Training &amp; KI-Coach
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Prüfungssimulation, Schwächenanalyse und Bestehenswahrscheinlichkeit in Echtzeit –
                für über 200 IHK- und HWK-Ausbildungsberufe.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Jetzt Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/berufe">Berufe entdecken</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              So unterstützt dich <span className="text-gradient">ExamFit</span>
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="glass-card">
                <CardHeader>
                  <BookOpen className="h-10 w-10 text-primary mb-4" />
                  <CardTitle>Strukturiertes Training</CardTitle>
                  <CardDescription>
                    Lernmodule zu allen Lernfeldern deines Ausbildungsberufs – orientiert am Rahmenplan.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <Target className="h-10 w-10 text-accent mb-4" />
                  <CardTitle>Adaptive Simulation</CardTitle>
                  <CardDescription>
                    Prüfungssimulation unter realistischen Bedingungen mit automatischer Schwächenanalyse.
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <Brain className="h-10 w-10 text-success mb-4" />
                  <CardTitle>KI-Prüfungscoach</CardTitle>
                  <CardDescription>
                    Erklärt Fehler, zeigt typische Prüfungsfallen und gibt gezielte Trainingsempfehlungen.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* B2B Teaser */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <div className="glass-card rounded-2xl p-8 md:p-12 text-center space-y-6">
              <Building2 className="h-12 w-12 text-primary mx-auto" />
              <h2 className="text-2xl md:text-3xl font-display font-bold">
                Für Betriebe: <span className="text-gradient">Plätze statt Kurse</span>
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Sie bilden in verschiedenen Berufen aus? Eine Teamlizenz für Ausbildung deckt alle IHK- und HWK-Berufe ab.
                Egal ob Automobilkaufmann, Mechatroniker oder Büromanagement – eine Lizenz reicht.
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-primary" /> Ab 29,80 €/Platz pro Jahr</span>
                <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" /> 5, 10 oder 25 Plätze</span>
                <span className="flex items-center gap-1.5"><Award className="h-4 w-4 text-primary" /> Alle Berufe enthalten</span>
              </div>
              <Button className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/betriebe">Mehr für Betriebe erfahren <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Berufe Grid */}
        <section className="py-16 bg-muted/30">
          <div className="container">
            <h2 className="text-3xl font-display font-bold mb-4">
              Wähle deinen <span className="text-gradient">Ausbildungsberuf</span>
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl">
              Prüfungstraining für alle IHK- und HWK-Ausbildungsberufe.
              Finde deinen Beruf und starte sofort.
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
                          <Badge variant="outline">{beruf.duration} Monate</Badge>
                          <span className="text-sm text-primary flex items-center">
                            Zum Training <ArrowRight className="ml-1 h-4 w-4" />
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
                  <Link to="/berufe">Alle {berufe.length} Berufe anzeigen</Link>
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen</h2>
            <div className="space-y-3">
              {FAQS.map(faq => (
                <details key={faq.question} className="group border border-border rounded-lg bg-card">
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">{faq.question}</summary>
                  <p className="px-6 pb-4 text-sm text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl md:text-4xl font-display font-bold">
              Bereit für deine IHK-Prüfung?
            </h2>
            <p className="text-xl text-muted-foreground">
              Starte jetzt mit der Vorbereitung und sichere dir den Prüfungserfolg.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">Jetzt Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                <Link to="/betriebe">Für Betriebe &amp; Teams</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
