import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const TYPISCHE_FRAGEN = [
  'Warum haben Sie diese Unterweisungsmethode gewählt?',
  'Wie stellen Sie sicher, dass der Azubi das Lernziel erreicht hat?',
  'Was tun Sie, wenn der Azubi das Thema nicht versteht?',
  'Welche rechtlichen Grundlagen sind für Ihr Thema relevant?',
  'Wie motivieren Sie einen unmotivierten Azubi?',
  'Wie gehen Sie mit Fehlern des Azubis in der Prüfungssituation um?',
  'Nennen Sie alternative Methoden für Ihre Ausbildungssituation.',
  'Wie dokumentieren Sie den Ausbildungsnachweis?',
];

const FAQS = [
  { question: 'Wie lange dauert das AEVO-Fachgespräch?', answer: 'Das Fachgespräch dauert ca. 15 Minuten und findet direkt im Anschluss an die Präsentation statt. Die Prüfer stellen Fragen zu deiner Methode, den Handlungsfeldern und didaktischen Begründungen.' },
  { question: 'Was fragen die Prüfer im AEVO-Fachgespräch?', answer: 'Typische Fragen betreffen die Methodenwahl, Lernzielkontrolle, rechtliche Grundlagen (BBiG, JArbSchG), Umgang mit schwierigen Azubis und alternative Ausbildungsmethoden.' },
  { question: 'Wie bereite ich mich auf das Fachgespräch vor?', answer: 'Kenne die 4 Handlungsfelder, die wichtigsten Gesetze und didaktischen Prinzipien. Übe mit typischen Prüferfragen und begründe deine Entscheidungen fachlich.' },
];

export default function AEVOFachgespraechPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'AEVO-Prüfung', url: `${SITE_URL}/aevo-pruefungsvorbereitung` },
    { name: 'Fachgespräch' },
  ];

  return (
    <>
      <SEOHead
        title="AEVO Fachgespräch – Typische Prüferfragen & Vorbereitung | ExamFit"
        description="AEVO Fachgespräch vorbereiten: Typische Prüferfragen zu Handlungsfeldern, Methoden & Recht. 15 Min. Gespräch nach der Präsentation. Mit Übungen & KI-Coach."
        canonical={`${SITE_URL}/aevo-fachgespraech`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'AEVO-Prüfung', href: '/aevo-pruefungsvorbereitung' },
              { label: 'Fachgespräch' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">AEVO · Fachgespräch</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">AEVO-Fachgespräch</span>: Prüferfragen meistern
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                15 Minuten Prüfergespräch zu Handlungsfeldern, Methoden und rechtlichen Grundlagen – so bereitest du dich gezielt vor.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/pruefungstraining/aevo">AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Typische Fragen */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">
              <MessageSquare className="inline-block h-6 w-6 mr-2 text-primary" />
              Typische Prüferfragen im AEVO-Fachgespräch
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {TYPISCHE_FRAGEN.map(f => (
                <Card key={f} className="border-border/50">
                  <CardContent className="py-3 px-4">
                    <p className="text-sm italic">„{f}"</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Tipps */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">So bestehst du das Fachgespräch</h2>
            <div className="space-y-3">
              {[
                'Kenne die 4 Handlungsfelder und ihre Inhalte',
                'Begründe jede Entscheidung fachlich-didaktisch',
                'Bereite Antworten auf die häufigsten Prüferfragen vor',
                'Bleib ruhig – Nachfragen sind normal und gewollt',
                'Verweise auf relevante Gesetze (BBiG, JArbSchG, AEVO)',
                'Zeige Flexibilität: Nenne immer Alternativen zu deiner Methode',
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
              title="AEVO-Fachgespräch simulieren"
              subtitle="5 typische Prüferfragen – teste dein Wissen"
              certificationSlug="aevo"
              ctaText="Vollständiges Training starten"
              ctaLink="/pruefungstraining/aevo"
            />
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/aevo-fachgespraech" title="Weitere AEVO-Vorbereitung" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum AEVO-Fachgespräch</h2>
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
            <h2 className="text-3xl font-display font-bold">Fachgespräch souverän bestehen</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/pruefungstraining/aevo">AEVO-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
