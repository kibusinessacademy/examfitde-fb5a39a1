import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Presentation, Clock, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const METHODEN = [
  { title: '4-Stufen-Methode', desc: 'Vorbereiten → Vormachen → Nachmachen → Üben. Klassische Unterweisung, ideal für manuelle Tätigkeiten.' },
  { title: 'Lehrgespräch', desc: 'Fragend-entwickelndes Verfahren, bei dem der Azubi zum Mitdenken angeregt wird.' },
  { title: 'Projektmethode', desc: 'Azubi plant und führt ein Projekt eigenverantwortlich durch – fördert Selbstständigkeit.' },
  { title: 'Moderation', desc: 'Azubis erarbeiten in Gruppenarbeit Ergebnisse – der Ausbilder moderiert den Prozess.' },
];

const FAQS = [
  { question: 'Wie läuft die praktische AEVO-Prüfung ab?', answer: 'Du präsentierst eine Ausbildungssituation (max. 15 Min.) und führst anschließend ein Fachgespräch (ca. 15 Min.) mit den Prüfern. Du wählst dein Thema und deine Methode selbst.' },
  { question: 'Welche Methode sollte ich für die Präsentation wählen?', answer: 'Die 4-Stufen-Methode ist am häufigsten. Wichtig ist, dass du die gewählte Methode didaktisch begründen kannst. Wähle eine Methode, die zu deinem Thema passt.' },
  { question: 'Was ist ein gutes AEVO-Präsentationsthema?', answer: 'Wähle ein Thema aus deinem Berufsalltag, das klar abgrenzbar und in 15 Min. darstellbar ist. Beispiele: Kassensystem bedienen, Werkstück vermessen, Kundenberatung durchführen.' },
];

export default function AEVOPraktischePage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'AEVO-Prüfung', url: `${SITE_URL}/aevo-pruefungsvorbereitung` },
    { name: 'Praktische Prüfung' },
  ];

  return (
    <>
      <SEOHead
        title="AEVO praktische Prüfung – Präsentation, 4-Stufen-Methode & Tipps | ExamFit"
        description="AEVO praktische Prüfung vorbereiten: 15 Min. Präsentation + Fachgespräch. 4-Stufen-Methode, Themenwahl, Gliederung und Prüfertipps. Jetzt üben!"
        canonical={`${SITE_URL}/aevo-praktische-pruefung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'AEVO-Prüfung', href: '/aevo-pruefungsvorbereitung' },
              { label: 'Praktische Prüfung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">AEVO · Praktisch</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">AEVO praktische Prüfung</span>: Präsentation & Unterweisung
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                15 Minuten Präsentation einer Ausbildungssituation – mit der richtigen Methode, Gliederung und Medieneinsatz überzeugst du die Prüfer.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/pruefungstraining/aevo">AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Format */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl grid sm:grid-cols-3 gap-4">
            {[
              { icon: Presentation, label: 'Präsentation', value: 'max. 15 Min.' },
              { icon: Clock, label: 'Fachgespräch', value: 'ca. 15 Min.' },
              { icon: Target, label: 'Bestehen', value: 'mind. 50%' },
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
        </section>

        {/* Methoden */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Unterweisungsmethoden für die AEVO-Prüfung</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {METHODEN.map(m => (
                <Card key={m.title} className="border-border/50">
                  <CardContent className="py-4">
                    <h3 className="font-semibold mb-1">{m.title}</h3>
                    <p className="text-sm text-muted-foreground">{m.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Tipps */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Tipps für die praktische AEVO-Prüfung</h2>
            <div className="space-y-3">
              {[
                'Wähle ein Thema aus deinem echten Berufsalltag',
                'Strukturiere klar: Einleitung, Lernziel, Methode, Durchführung, Ergebnis',
                'Begründe deine Methodenwahl didaktisch',
                'Setze Medien gezielt ein (Flip-Chart, Modelle, Handout)',
                'Übe die Präsentation mehrfach auf 15 Min. Timing',
                'Bereite Antworten auf typische Prüferfragen vor',
              ].map(t => (
                <div key={t} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/aevo-praktische-pruefung" title="Weitere AEVO-Vorbereitung" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur praktischen AEVO-Prüfung</h2>
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
            <h2 className="text-3xl font-display font-bold">AEVO-Präsentation souverän meistern</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/pruefungstraining/aevo">Jetzt AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
