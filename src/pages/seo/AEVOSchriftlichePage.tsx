import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, Target, ListChecks, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Wie viele Fragen hat die schriftliche AEVO-Prüfung?', answer: '80 Multiple-Choice-Fragen in 180 Minuten. Die Fragen sind als Fallaufgaben formuliert – du bekommst einen Sachverhalt und musst die richtige Antwort auswählen.' },
  { question: 'Was ist das Alles-oder-Nichts-Prinzip bei der AEVO?', answer: 'Bei Multiple-Choice-Fragen mit mehreren richtigen Antworten müssen alle korrekten Optionen markiert werden. Teilrichtige Antworten geben keine Punkte.' },
  { question: 'Wie bestehe ich die schriftliche AEVO-Prüfung?', answer: 'Du brauchst mindestens 50% der Punkte (40 von 80 Fragen richtig). Konzentriere dich auf die 4 Handlungsfelder und übe mit prüfungsnahen Fallaufgaben.' },
];

export default function AEVOSchriftlichePage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'AEVO-Prüfung', url: `${SITE_URL}/aevo-pruefungsvorbereitung` },
    { name: 'Schriftliche Prüfung' },
  ];

  return (
    <>
      <SEOHead
        title="AEVO schriftliche Prüfung – 80 MC-Fragen, Fallaufgaben & Tipps | ExamFit"
        description="AEVO schriftliche Prüfung: 80 Multiple-Choice-Fragen in 180 Min. Fallaufgaben zu 4 Handlungsfeldern, Alles-oder-Nichts-Prinzip. Mit Übungen & Probeprüfung."
        canonical={`${SITE_URL}/aevo-schriftliche-pruefung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'AEVO-Prüfung', href: '/aevo-pruefungsvorbereitung' },
              { label: 'Schriftliche Prüfung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">AEVO · Schriftlich</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">AEVO schriftliche Prüfung</span>: Multiple-Choice meistern
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                80 Fragen in 180 Minuten – Fallaufgaben zu allen 4 Handlungsfeldern. So bereitest du dich optimal vor.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/pruefungstraining/aevo">AEVO-MC-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Steckbrief */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Prüfungsformat auf einen Blick</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: ListChecks, label: 'Fragen', value: '80 MC-Fragen' },
                { icon: Clock, label: 'Dauer', value: '180 Minuten' },
                { icon: Target, label: 'Bestehen', value: 'mind. 50%' },
                { icon: AlertTriangle, label: 'Prinzip', value: 'Alles oder Nichts' },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="py-4 text-center space-y-2">
                    <s.icon className="h-8 w-8 mx-auto text-primary" />
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="font-semibold">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Tipps */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Tipps für die schriftliche AEVO-Prüfung</h2>
            <div className="space-y-3">
              {[
                'Lies den Sachverhalt vollständig, bevor du die Antwortmöglichkeiten prüfst',
                'Markiere alle richtigen Antworten – Teilpunkte gibt es nicht',
                'Verteile deine Zeit: maximal 2 Minuten pro Frage',
                'Konzentriere dich auf BBiG, JArbSchG und die 4 Handlungsfelder',
                'Übe mit prüfungsnahen Fallaufgaben – nicht nur mit Einzelfragen',
              ].map(t => (
                <div key={t} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Quiz */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="AEVO Multiple-Choice-Test"
              subtitle="Teste dich mit 5 prüfungsnahen Fragen"
              certificationSlug="aevo"
              ctaText="Vollständiges MC-Training starten"
              ctaLink="/pruefungstraining/aevo"
            />
          </div>
        </section>

        {/* Links */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/aevo-schriftliche-pruefung" title="Weitere AEVO-Vorbereitung" />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur schriftlichen AEVO-Prüfung</h2>
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

        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl font-display font-bold">AEVO-Klausur sicher bestehen</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/pruefungstraining/aevo">Jetzt MC-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
