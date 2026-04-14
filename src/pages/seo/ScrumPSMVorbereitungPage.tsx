import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, BookOpen, Target, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const FAQS = [
  { question: 'Was ist die PSM I Prüfung?', answer: 'Die Professional Scrum Master I (PSM I) Prüfung von Scrum.org testet fundiertes Wissen über den Scrum Guide. 80 Fragen in 60 Minuten, 85% zum Bestehen. Keine Schulungspflicht – du kannst dich selbstständig vorbereiten.' },
  { question: 'Wie bereite ich mich auf PSM I vor?', answer: 'Lies den Scrum Guide gründlich (mehrfach). Übe mit den kostenlosen Scrum Open Assessments. Nutze ExamFit für prüfungsnahe Fragen mit Erklärungen und Zeitdruck-Simulation.' },
  { question: 'Was kostet die PSM I Prüfung?', answer: 'Die PSM I Prüfung kostet ca. 200 USD bei Scrum.org. Keine Kursgebühr nötig. ExamFit-Vorbereitung gibt es ab ' + PRICING.defaultPrice + '.' },
];

export default function ScrumPSMVorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Scrum & PRINCE2', url: `${SITE_URL}/scrum-prince2-zertifizierung` },
    { name: 'PSM I Vorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="PSM I Zertifizierung vorbereiten – Professional Scrum Master Prüfung | ExamFit"
        description="PSM I Prüfung bestehen: Scrum Guide lernen, Open Assessments üben und mit prüfungsnaher Simulation bei ExamFit trainieren. Alles zur PSM I Vorbereitung."
        canonical={`${SITE_URL}/scrum-psm-vorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Scrum & PRINCE2', href: '/scrum-prince2-zertifizierung' },
              { label: 'PSM I Vorbereitung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Scrum-Zertifizierung</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">PSM I Zertifizierung</span> vorbereiten und bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Professional Scrum Master I: 80 Fragen, 60 Minuten, 85% zum Bestehen. Mit ExamFit trainierst du prüfungsnah und erkennst Wissenslücken frühzeitig.
              </p>
              <Button size="lg" asChild><Link to="/projektmanagement/scrum">Scrum-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">PSM I Prüfung: Aufbau & Anforderungen</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: BookOpen, title: '80 Fragen', desc: 'Multiple Choice & True/False aus dem Scrum Guide' },
                { icon: Target, title: '60 Minuten', desc: 'Zeitdruck: durchschnittlich 45 Sek. pro Frage' },
                { icon: Brain, title: '85% Bestehen', desc: 'Hohes Niveau – tiefes Verständnis nötig, kein Auswendiglernen' },
              ].map((item, i) => (
                <div key={i} className="text-center p-6 rounded-xl bg-muted/50">
                  <item.icon className="h-8 w-8 text-primary mx-auto mb-3" />
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-6">So bereitest du dich optimal vor</h2>
            <div className="space-y-4">
              {[
                'Scrum Guide 2020 mehrfach lesen und Konzepte verstehen',
                'Scrum Open Assessment auf scrum.org durcharbeiten',
                'Prüfungsfragen bei ExamFit unter Zeitdruck üben',
                'Schwächen identifizieren und gezielt nacharbeiten',
                'Mock-Exams mit realistischem Bestehens-Indikator nutzen',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border/50">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOQuizWidget certificationSlug="scrum" title="PSM I Wissen testen" maxQuestions={5} />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/scrum-psm-vorbereitung" title="Weitere Zertifizierungen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zur PSM I Prüfung</h2>
            <div className="space-y-6">
              {FAQS.map((faq, i) => (
                <div key={i} className="border-b border-border/50 pb-6">
                  <h3 className="font-semibold text-lg mb-2">{faq.question}</h3>
                  <p className="text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
