import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, BookOpen, Target, Brain, Award, Shield, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const CLUSTERS = [
  { title: 'IHK-Prüfungsfragen', desc: 'Typische IHK-Fragen mit Lösungen üben', href: '/ihk-pruefungsfragen', icon: BookOpen },
  { title: 'IHK-Fachgespräch', desc: 'Mündliche Prüfung & Fachgespräch vorbereiten', href: '/ihk-fachgespraech', icon: Brain },
  { title: 'IHK-Probeprüfung', desc: 'Realistische Prüfungssimulation online', href: '/ihk-probepruefung', icon: Target },
  { title: 'AEVO-Prüfung', desc: 'Ausbildereignungsprüfung (AdA-Schein)', href: '/aevo-pruefungsvorbereitung', icon: Award },
  { title: 'Ausbildungsprüfungen', desc: 'Alle IHK-Ausbildungsberufe', href: '/ausbildung', icon: GraduationCap },
  { title: 'Sachkundeprüfungen', desc: '§34a, §34d, §34f GewO', href: '/sachkunde', icon: Shield },
];

const FAQS = [
  { question: 'Wie bereite ich mich auf die IHK-Prüfung vor?', answer: 'Die beste IHK-Prüfungsvorbereitung kombiniert strukturiertes Lernen mit aktivem Üben. ExamFit bietet prüfungsnahe Fragen, Simulation und KI-Coach – so erkennst du Schwächen frühzeitig und trainierst gezielt.' },
  { question: 'Welche IHK-Prüfungsarten gibt es?', answer: 'IHK-Prüfungen umfassen Ausbildungsprüfungen (Teil 1 und 2), Fortbildungsprüfungen (Fachwirt, Meister, Betriebswirt), Sachkundeprüfungen (§34a/d/f) und die Ausbildereignungsprüfung (AEVO).' },
  { question: 'Wie realistisch ist eine IHK-Probeprüfung bei ExamFit?', answer: 'Die Prüfungssimulation bildet echte IHK-Bedingungen nach: gleiche Zeitvorgaben, prüfungskonforme Aufgabentypen und Bestehensindikator. So weißt du vor der echten Prüfung, wo du stehst.' },
  { question: 'Was kostet das IHK-Prüfungstraining?', answer: `ExamFit kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang. Alle Module inklusive: Prüfungsfragen, Simulation, mündliche Prüfung und KI-Coach.` },
];

export default function IHKPruefungsvorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'IHK-Prüfungsvorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="IHK-Prüfungsvorbereitung online – Fragen, Training & Simulation | ExamFit"
        description="IHK-Prüfungsvorbereitung mit prüfungsnahen Fragen, realistischer Simulation und KI-Coach. Für Ausbildung, Fachwirt, Meister, AEVO & Sachkunde. Jetzt starten!"
        canonical={`${SITE_URL}/ihk-pruefungsvorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'IHK-Prüfungsvorbereitung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">IHK-Prüfungsvorbereitung</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Prüfungsvorbereitung</span>: Abschlussprüfung sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Strukturiertes Prüfungstraining mit echten IHK-Fragetypen, realistischer Prüfungssimulation und persönlichem KI-Prüfungscoach.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">IHK-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/ihk-pruefungsfragen">Prüfungsfragen üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Cluster-Karten */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Dein Weg zur <span className="text-gradient">IHK-Prüfung</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {CLUSTERS.map(c => (
                <Link key={c.href} to={c.href}>
                  <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group">
                    <CardContent className="pt-6 space-y-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary w-fit"><c.icon className="h-6 w-6" /></div>
                      <h3 className="font-semibold group-hover:text-primary transition-colors">{c.title}</h3>
                      <p className="text-sm text-muted-foreground">{c.desc}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Quiz Widget */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="Teste dein IHK-Prüfungswissen"
              subtitle="5 Fragen – wie gut bist du vorbereitet?"
              certificationSlug="aevo"
              ctaText="Jetzt IHK-Training starten"
              ctaLink="/shop"
            />
          </div>
        </section>

        {/* Vorteile */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Warum IHK-Prüfungsvorbereitung mit <span className="text-gradient">ExamFit</span>?</h2>
            <div className="space-y-4">
              {[
                'Prüfungsnahe Fragen nach aktuellem IHK-Rahmenplan',
                'Realistische Prüfungssimulation mit Zeitvorgabe',
                'KI-Coach erkennt Schwächen und erstellt individuellen Lernplan',
                'Mündliche Prüfung und Fachgespräch gezielt trainieren',
                'Bestehenswahrscheinlichkeit in Echtzeit',
                'Einmalzahlung, kein Abo – voller Zugang',
              ].map(p => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* DB-driven Internal Links */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks
              sourceUrl="/ihk-pruefungsvorbereitung"
              linkTypes={['pillar_to_cluster']}
              title="IHK-Prüfungsbereiche vertiefen"
            />
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks
              sourceUrl="/ihk-pruefungsvorbereitung"
              linkTypes={['cluster_to_product']}
              title="Prüfungstraining für deinen Beruf"
              maxLinks={6}
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur IHK-Prüfungsvorbereitung</h2>
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

        {/* CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl font-display font-bold">Bereit für deine IHK-Prüfung?</h2>
            <p className="text-xl text-muted-foreground">Starte jetzt – nur {PRICING.defaultPrice} für {PRICING.defaultAccess}.</p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt IHK-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
