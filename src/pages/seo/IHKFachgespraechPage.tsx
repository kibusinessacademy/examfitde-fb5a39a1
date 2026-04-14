import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const TYPISCHE_FRAGEN = [
  'Beschreiben Sie einen typischen Arbeitstag in Ihrem Beruf.',
  'Wie gehen Sie mit einem schwierigen Kunden um?',
  'Erklären Sie den Ablauf eines wichtigen Arbeitsprozesses.',
  'Welche Vorschriften sind in Ihrem Bereich besonders wichtig?',
  'Wie würden Sie einen neuen Kollegen einarbeiten?',
  'Was war Ihre größte berufliche Herausforderung?',
];

const FAQS = [
  { question: 'Wie läuft das IHK-Fachgespräch ab?', answer: 'Das Fachgespräch dauert je nach Prüfung 15–30 Minuten. Prüfer stellen Fragen zu deinem Fachgebiet, Arbeitsprozessen und beruflichem Handeln. Du sollst zeigen, dass du Zusammenhänge verstehst.' },
  { question: 'Wie bereite ich mich auf die mündliche IHK-Prüfung vor?', answer: 'Wiederhole die wichtigsten Fachthemen, übe mit typischen Prüferfragen und trainiere deine Ausdrucksfähigkeit. Der KI-Coach bei ExamFit simuliert ein realistisches Fachgespräch.' },
];

export default function IHKFachgespraechPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'IHK-Prüfungsvorbereitung', url: `${SITE_URL}/ihk-pruefungsvorbereitung` },
    { name: 'IHK-Fachgespräch' },
  ];

  return (
    <>
      <SEOHead
        title="IHK-Fachgespräch & mündliche Prüfung vorbereiten | ExamFit"
        description="IHK-Fachgespräch und mündliche Prüfung vorbereiten: Typische Prüferfragen, Ablauf und Tipps. Mit KI-gestütztem Fachgespräch-Training. Jetzt üben!"
        canonical={`${SITE_URL}/ihk-fachgespraech`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'IHK-Prüfungsvorbereitung', href: '/ihk-pruefungsvorbereitung' },
              { label: 'Fachgespräch' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">IHK · Mündliche Prüfung</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Fachgespräch</span> & mündliche Prüfung vorbereiten
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Typische Prüferfragen kennen, souverän antworten und das Fachgespräch bestehen – mit KI-gestütztem Training.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/shop">Fachgespräch-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">
              <MessageSquare className="inline-block h-6 w-6 mr-2 text-primary" />
              Typische Prüferfragen im IHK-Fachgespräch
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {TYPISCHE_FRAGEN.map(f => (
                <Card key={f} className="border-border/50">
                  <CardContent className="py-3 px-4"><p className="text-sm italic">„{f}"</p></CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">So bestehst du das IHK-Fachgespräch</h2>
            <div className="space-y-3">
              {[
                'Kenne die wichtigsten Fachbegriffe und Prozesse deines Berufs',
                'Übe das freie Sprechen über deine Arbeitsprozesse',
                'Bereite Beispiele aus deinem Berufsalltag vor',
                'Bleib ruhig und nachfragen ist erlaubt',
                'Trainiere mit dem KI-Prüfungscoach unter realistischen Bedingungen',
              ].map(t => (
                <div key={t} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/ihk-fachgespraech" title="Weitere IHK-Prüfungsvorbereitung" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum IHK-Fachgespräch</h2>
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
            <h2 className="text-3xl font-display font-bold">Mündliche Prüfung souverän bestehen</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Fachgespräch-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
