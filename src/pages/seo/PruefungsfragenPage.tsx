import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, BookOpen, Target, Brain, HelpCircle, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, generateOrganizationSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Wie viele Prüfungsfragen bietet ExamFit?', answer: 'ExamFit bietet über 1.100 Prüfungsfragen pro Prüfungstrainer. Alle Fragen sind prüfungsnah formuliert und orientieren sich am aktuellen Rahmenplan.' },
  { question: 'Gibt es Prüfungsfragen mit Lösungen?', answer: 'Ja, jede Frage hat eine ausführliche Lösung mit Erklärung. Der KI-Coach erklärt zusätzlich typische Fehler und gibt dir gezielte Hinweise.' },
  { question: 'Kann ich Prüfungsfragen nach Thema filtern?', answer: 'Ja, alle Fragen sind nach Lernfeldern und Kompetenzbereichen strukturiert. Du kannst gezielt Schwachstellen trainieren.' },
  { question: 'Sind die Prüfungsfragen aktuell?', answer: 'Alle Fragen werden regelmäßig aktualisiert und orientieren sich an den aktuellen Prüfungsordnungen und Rahmenlehrplänen.' },
  { question: 'Für welche Prüfungen gibt es Fragen?', answer: 'ExamFit deckt IHK-Prüfungen, HWK-Prüfungen, Sachkundeprüfungen, Fachwirt- und Meisterprüfungen sowie Zertifizierungen ab.' },
];

const FRAGE_TYPEN = [
  { icon: ListChecks, title: 'Multiple Choice', desc: 'Klassische MC-Fragen mit einer oder mehreren richtigen Antworten – wie in der echten Prüfung.' },
  { icon: HelpCircle, title: 'Offene Fragen', desc: 'Transferaufgaben und Fallbeispiele, die Verständnis statt Auswendiglernen prüfen.' },
  { icon: Target, title: 'Situationsaufgaben', desc: 'Praxisnahe Szenarien aus dem Berufsalltag – besonders prüfungsrelevant.' },
];

export default function PruefungsfragenPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Prüfungsfragen' },
  ];

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema(FAQS),
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title="Prüfungsfragen online üben – 1.100+ Fragen mit Lösungen | ExamFit"
        description="Prüfungsfragen online üben: Über 1.100 prüfungsnahe Fragen mit Lösungen für IHK, HWK, Sachkunde und Fachwirt. Mit KI-Coach und Schwächenanalyse."
        canonical={`${SITE_URL}/pruefungsfragen`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Prüfungsfragen' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                Prüfungsfragen üben
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Prüfungsfragen</span> online üben
                <br />
                <span className="text-2xl md:text-3xl text-muted-foreground font-normal">mit Lösungen, Erklärungen &amp; KI-Coach</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Über 1.100 prüfungsnahe Fragen pro Trainer – strukturiert nach Lernfeldern, 
                mit ausführlichen Lösungen und adaptiver Schwächenanalyse.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Prüfungsfragen starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/probepruefung">Probeprüfung machen</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Fragetypen */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Typische <span className="text-gradient">Prüfungsfragen</span> – genau wie in der echten Prüfung
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              {FRAGE_TYPEN.map(typ => (
                <Card key={typ.title} className="glass-card">
                  <CardHeader>
                    <typ.icon className="h-10 w-10 text-primary mb-4" />
                    <CardTitle>{typ.title}</CardTitle>
                    <CardDescription>{typ.desc}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Vorteile */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">
              So helfen dir <span className="text-gradient">ExamFit-Prüfungsfragen</span>
            </h2>
            <div className="space-y-4">
              {[
                'Jede Frage mit ausführlicher Lösung und Erklärung',
                'KI-Coach erklärt typische Prüfungsfallen',
                'Adaptive Wiederholung: Schwache Themen werden häufiger gezeigt',
                'Strukturiert nach Lernfeldern und Kompetenzbereichen',
                'Bestehenswahrscheinlichkeit in Echtzeit',
                'Prüfungssimulation unter realistischen Bedingungen',
              ].map(punkt => (
                <div key={punkt} className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{punkt}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Produkt-Links */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">
              Prüfungsfragen für deinen <span className="text-gradient">Beruf</span>
            </h2>
            <SEOInternalLinks 
              sourceUrl="/pruefungsfragen" 
              linkTypes={['cluster_to_product']}
              maxLinks={6}
            />
            <div className="mt-6 text-center">
              <Button variant="outline" asChild>
                <Link to="/pruefungstraining">Alle Prüfungstrainer entdecken <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Cluster-Links */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks 
              sourceUrl="/pruefungsfragen" 
              linkTypes={['cluster_to_pillar', 'cluster_to_cluster']}
              title="Weitere Prüfungsvorbereitung"
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zu Prüfungsfragen</h2>
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

        {/* Final CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl md:text-4xl font-display font-bold">
              Bereit, deine Prüfungsfragen zu üben?
            </h2>
            <p className="text-xl text-muted-foreground">
              Starte jetzt und trainiere mit über 1.100 prüfungsnahen Fragen.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Prüfungsfragen starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
