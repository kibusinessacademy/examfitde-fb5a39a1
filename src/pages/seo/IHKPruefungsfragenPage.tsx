import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { useCertificationCatalog } from '@/hooks/useCertificationSEO';

const FAQS = [
  { question: 'Welche IHK-Prüfungsfragen gibt es bei ExamFit?', answer: 'ExamFit bietet über 1.100 prüfungsnahe Fragen pro Trainer – für IHK-Ausbildungsprüfungen, Fachwirt, Meister, AEVO und Sachkunde. Alle Fragen orientieren sich am aktuellen Rahmenplan.' },
  { question: 'Gibt es IHK-Prüfungsfragen mit Lösungen?', answer: 'Ja, jede Frage enthält eine ausführliche Lösung mit Erklärung. Der KI-Coach erklärt zusätzlich typische Prüfungsfallen und gibt dir gezielte Hinweise.' },
  { question: 'Sind die IHK-Prüfungsfragen aktuell?', answer: 'Alle Fragen werden regelmäßig aktualisiert und orientieren sich an den aktuellen IHK-Prüfungsordnungen und Rahmenlehrplänen.' },
];

export default function IHKPruefungsfragenPage() {
  const { data: catalog } = useCertificationCatalog();
  const ihkCerts = catalog?.filter(c => c.chamber_type === 'IHK').slice(0, 8) ?? [];

  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'IHK-Prüfungsvorbereitung', url: `${SITE_URL}/ihk-pruefungsvorbereitung` },
    { name: 'IHK-Prüfungsfragen' },
  ];

  return (
    <>
      <SEOHead
        title="IHK-Prüfungsfragen mit Lösungen online üben | ExamFit"
        description="IHK-Prüfungsfragen online üben: Über 1.100 prüfungsnahe Fragen mit Lösungen für Ausbildung, Fachwirt, Meister & AEVO. Mit KI-Coach und Schwächenanalyse."
        canonical={`${SITE_URL}/ihk-pruefungsfragen`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'IHK-Prüfungsvorbereitung', href: '/ihk-pruefungsvorbereitung' },
              { label: 'Prüfungsfragen' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">IHK-Prüfungsfragen</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Prüfungsfragen</span> mit Lösungen online üben
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Über 1.100 prüfungsnahe Fragen pro Trainer – strukturiert nach Lernfeldern, mit ausführlichen Lösungen und KI-Coach.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/shop">IHK-Prüfungsfragen starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Vorteile der IHK-Prüfungsfragen bei ExamFit</h2>
            <div className="space-y-3">
              {[
                'Prüfungsnahe Fragen nach aktuellem IHK-Rahmenplan',
                'Jede Frage mit ausführlicher Lösung und Erklärung',
                'KI-Coach erklärt typische Prüfungsfallen',
                'Adaptive Wiederholung: Schwache Themen werden häufiger gezeigt',
                'Strukturiert nach Lernfeldern und Kompetenzen',
              ].map(p => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Quiz */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="IHK-Prüfungsfragen testen"
              subtitle="5 Beispielfragen – wie gut bist du vorbereitet?"
              certificationSlug="aevo"
              ctaText="Alle IHK-Fragen üben"
              
            />
          </div>
        </section>

        {/* Beliebte IHK-Prüfungen */}
        {ihkCerts.length > 0 && (
          <section className="py-16 bg-muted/30">
            <div className="container max-w-4xl">
              <h2 className="text-2xl font-display font-bold mb-6">
                <BookOpen className="inline-block h-6 w-6 mr-2 text-primary" />
                Beliebte IHK-Prüfungsfragen
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {ihkCerts.map(c => (
                  <Link key={c.id} to={`/pruefungstraining/${c.slug}`} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
                    <span className="text-sm font-medium">{c.title}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/ihk-pruefungsfragen" title="Weitere IHK-Prüfungsvorbereitung" />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zu IHK-Prüfungsfragen</h2>
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
            <h2 className="text-3xl font-display font-bold">IHK-Prüfungsfragen jetzt üben</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
