import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Shield, BookOpen, Target, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const FAQS = [
  { question: 'Was ist die PRINCE2 Foundation Prüfung?', answer: 'Die PRINCE2 Foundation Prüfung testet Grundwissen zu 7 Prinzipien, 7 Themes und 7 Prozessen. 60 Multiple-Choice-Fragen in 60 Minuten, 55% (33 von 60) zum Bestehen. Closed-Book-Prüfung.' },
  { question: 'Brauche ich einen Kurs für PRINCE2 Foundation?', answer: 'Ein akkreditierter Kurs ist empfohlen, aber nicht zwingend. Selbststudium mit offiziellem Handbuch ist möglich. ExamFit bietet ergänzendes prüfungsnahes Training.' },
  { question: 'Was sind die 7 PRINCE2 Prinzipien?', answer: '1) Fortlaufende geschäftliche Rechtfertigung, 2) Lernen aus Erfahrung, 3) Definierte Rollen & Verantwortlichkeiten, 4) Steuern über Managementphasen, 5) Steuern nach dem Ausnahmeprinzip, 6) Produktorientierung, 7) Anpassen an die Projektumgebung.' },
  { question: 'Was kostet PRINCE2 Foundation?', answer: `Prüfungsgebühr ca. 300–400€. Kurse ab ca. 800€. ExamFit-Training gibt es ab ${PRICING.defaultPrice} für prüfungsnahe Vorbereitung.` },
];

export default function Prince2FoundationPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Scrum & PRINCE2', url: `${SITE_URL}/scrum-prince2-zertifizierung` },
    { name: 'PRINCE2 Foundation' },
  ];

  return (
    <>
      <SEOHead
        title="PRINCE2 Foundation Prüfung vorbereiten – 7 Prinzipien, Themes & Prozesse | ExamFit"
        description="PRINCE2 Foundation Prüfung bestehen: 7 Prinzipien, 7 Themes, 7 Prozesse lernen. 60 Fragen, 55% zum Bestehen. Prüfungsnahe Simulation bei ExamFit."
        canonical={`${SITE_URL}/prince2-foundation`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Scrum & PRINCE2', href: '/scrum-prince2-zertifizierung' },
              { label: 'PRINCE2 Foundation' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">PRINCE2</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">PRINCE2 Foundation</span> Prüfung sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                7 Prinzipien, 7 Themes, 7 Prozesse – mit prüfungsnahen Fragen und Simulation bei ExamFit meisterst du die PRINCE2 Foundation.
              </p>
              <Button size="lg" asChild><Link to="/projektmanagement/prince2">PRINCE2-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">PRINCE2 Foundation: Prüfungsstruktur</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: BookOpen, title: '60 Fragen', desc: 'Multiple Choice, Closed Book' },
                { icon: Target, title: '60 Minuten', desc: '1 Minute pro Frage' },
                { icon: Shield, title: '55% Bestehen', desc: '33 von 60 richtig nötig' },
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
            <h2 className="text-3xl font-display font-bold mb-6">Die 7 PRINCE2 Prinzipien</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                'Fortlaufende geschäftliche Rechtfertigung',
                'Lernen aus Erfahrung',
                'Definierte Rollen & Verantwortlichkeiten',
                'Steuern über Managementphasen',
                'Steuern nach dem Ausnahmeprinzip',
                'Produktorientierung',
                'Anpassen an die Projektumgebung',
              ].map((p, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border/50">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span><strong>{i + 1}.</strong> {p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOQuizWidget certificationSlug="prince2" title="PRINCE2 Foundation Wissen testen" maxQuestions={5} />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/prince2-foundation" title="Weitere Zertifizierungen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zur PRINCE2 Foundation</h2>
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
