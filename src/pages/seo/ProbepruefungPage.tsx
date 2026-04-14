import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Clock, BarChart3, Target, Repeat, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, generateOrganizationSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Wie realistisch ist die Probeprüfung bei ExamFit?', answer: 'Die Probeprüfung simuliert echte Prüfungsbedingungen: Zeitlimit, zufällige Fragenauswahl, Bestehensgrenze und Ergebnisprotokoll – wie bei der echten Prüfung.' },
  { question: 'Wie viele Probeprüfungen kann ich machen?', answer: 'Unbegrenzt. Du kannst die Prüfungssimulation beliebig oft wiederholen. Jede Simulation nutzt einen neuen Fragenmix.' },
  { question: 'Bekomme ich ein Ergebnis nach der Probeprüfung?', answer: 'Ja, du erhältst eine detaillierte Auswertung: Punktzahl, Bestehenswahrscheinlichkeit, Stärken/Schwächen-Analyse und Empfehlungen.' },
  { question: 'Kann ich die Probeprüfung auch auf dem Handy machen?', answer: 'Ja, ExamFit ist vollständig mobil nutzbar. Du kannst Probeprüfungen überall machen – auch offline nach dem ersten Laden.' },
  { question: 'Gibt es Probeprüfungen für mündliche Prüfungen?', answer: 'ExamFit bietet auch Fachgespräch-Fragen zum Üben. Eine klassische Simulation mit Gesprächspartner ist aktuell nicht enthalten.' },
];

const FEATURES = [
  { icon: Clock, title: 'Echtes Zeitlimit', desc: 'Die Simulation läuft unter realistischem Zeitdruck – genau wie in der echten Prüfung.' },
  { icon: Target, title: 'Zufälliger Fragenmix', desc: 'Jede Probeprüfung enthält einen neuen Mix aus allen Themengebieten.' },
  { icon: BarChart3, title: 'Bestehenswahrscheinlichkeit', desc: 'Nach jeder Simulation siehst du deine aktuelle Bestehenswahrscheinlichkeit.' },
  { icon: Repeat, title: 'Unbegrenzt wiederholbar', desc: 'Mache so viele Probeprüfungen wie du willst – jede ist anders.' },
];

export default function ProbepruefungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Probeprüfung' },
  ];

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema(FAQS),
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title="Probeprüfung online machen – Prüfungssimulation mit Auswertung | ExamFit"
        description="Probeprüfung online machen: Realistische Prüfungssimulation mit Zeitlimit, Bestehenswahrscheinlichkeit und Schwächenanalyse. IHK, Sachkunde & Fachwirt."
        canonical={`${SITE_URL}/probepruefung`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Probeprüfung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                Prüfungssimulation
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Probeprüfung</span> online machen
                <br />
                <span className="text-2xl md:text-3xl text-muted-foreground font-normal">Realistische Simulation unter Prüfungsbedingungen</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Teste dein Wissen unter echten Prüfungsbedingungen: Zeitlimit, zufällige Fragen 
                und sofortige Auswertung mit Bestehenswahrscheinlichkeit.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Probeprüfung starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/pruefungsfragen">Erst Prüfungsfragen üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              So funktioniert die <span className="text-gradient">Probeprüfung</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {FEATURES.map(f => (
                <Card key={f.title} className="glass-card">
                  <CardHeader>
                    <f.icon className="h-10 w-10 text-primary mb-4" />
                    <CardTitle>{f.title}</CardTitle>
                    <CardDescription>{f.desc}</CardDescription>
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
              Warum eine <span className="text-gradient">Probeprüfung</span> deine Chancen erhöht
            </h2>
            <div className="space-y-4">
              {[
                'Du erkennst Wissenslücken, bevor es zählt',
                'Du gewöhnst dich an den Zeitdruck der echten Prüfung',
                'Du siehst deine Bestehenswahrscheinlichkeit in Echtzeit',
                'Du reduzierst Prüfungsangst durch Übung',
                'Du bekommst gezielte Lernempfehlungen nach jeder Simulation',
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
              Probeprüfung für deine <span className="text-gradient">Prüfung</span>
            </h2>
            <SEOInternalLinks 
              sourceUrl="/probepruefung" 
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
              sourceUrl="/probepruefung" 
              linkTypes={['cluster_to_pillar', 'cluster_to_cluster']}
              title="Weitere Prüfungsvorbereitung"
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur Probeprüfung</h2>
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
              Teste dein Wissen unter echten Bedingungen
            </h2>
            <p className="text-xl text-muted-foreground">
              Starte jetzt deine Probeprüfung und finde heraus, ob du bestehen würdest.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Probeprüfung starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
