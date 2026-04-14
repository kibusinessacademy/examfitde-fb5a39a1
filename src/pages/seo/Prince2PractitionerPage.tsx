import { Link } from 'react-router-dom';
import { ArrowRight, Layers, BookOpen, Target, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Was ist die PRINCE2 Practitioner Prüfung?', answer: 'Die Practitioner-Prüfung testet die Anwendung von PRINCE2 in Szenarien. 68 Fragen in 150 Minuten, 55% zum Bestehen. Open-Book-Prüfung (offizielles Handbuch erlaubt). Voraussetzung: PRINCE2 Foundation.' },
  { question: 'Wie unterscheidet sich Practitioner von Foundation?', answer: 'Foundation testet Wissen (Recall), Practitioner testet Anwendung (Apply). Practitioner-Fragen basieren auf Fallstudien und erfordern die Anwendung von Prinzipien, Themes und Prozessen auf reale Szenarien.' },
  { question: 'Wie bereite ich mich auf PRINCE2 Practitioner vor?', answer: 'Vertiefe die 7 Prozesse und ihre Anwendung. Übe mit szenariobasierten Fragen. Lerne das Handbuch effizient zu navigieren (Open Book). ExamFit bietet prüfungsnahe Fallstudien-Übungen.' },
];

export default function Prince2PractitionerPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Scrum & PRINCE2', url: `${SITE_URL}/scrum-prince2-zertifizierung` },
    { name: 'PRINCE2 Practitioner' },
  ];

  return (
    <>
      <SEOHead
        title="PRINCE2 Practitioner Zertifizierung – Prozesse anwenden & Prüfung bestehen | ExamFit"
        description="PRINCE2 Practitioner Prüfung: Szenarien, Prozesse und Anwendung. 68 Fragen, 150 Min., Open Book. Prüfungsnahe Vorbereitung bei ExamFit."
        canonical={`${SITE_URL}/prince2-practitioner`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Scrum & PRINCE2', href: '/scrum-prince2-zertifizierung' },
              { label: 'PRINCE2 Practitioner' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">PRINCE2 Practitioner</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">PRINCE2 Practitioner</span>: Prozesse anwenden und bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Szenariobasierte Prüfung mit 68 Fragen in 150 Minuten. Lerne, PRINCE2 Prinzipien und Prozesse auf reale Projekte anzuwenden.
              </p>
              <Button size="lg" asChild><Link to="/projektmanagement/prince2">PRINCE2-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Practitioner Prüfung: Aufbau</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: BookOpen, title: '68 Fragen', desc: 'Szenariobasiert, Open Book' },
                { icon: Target, title: '150 Minuten', desc: 'Ausreichend Zeit für Fallstudien' },
                { icon: Shield, title: '55% Bestehen', desc: 'Anwendungswissen geprüft' },
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
            <h2 className="text-3xl font-display font-bold mb-6">Die 7 PRINCE2 Prozesse</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                'Vorbereiten eines Projekts (Starting Up)',
                'Lenken eines Projekts (Directing)',
                'Initiieren eines Projekts (Initiating)',
                'Steuern einer Phase (Controlling a Stage)',
                'Managen der Produktlieferung (Managing Product Delivery)',
                'Managen eines Phasenübergangs (Managing a Stage Boundary)',
                'Abschließen eines Projekts (Closing)',
              ].map((p, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-background rounded-lg border border-border/50">
                  <Layers className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span><strong>{i + 1}.</strong> {p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOQuizWidget certificationSlug="prince2" title="PRINCE2 Practitioner Wissen testen" maxQuestions={5} />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/prince2-practitioner" title="Weitere Zertifizierungen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zu PRINCE2 Practitioner</h2>
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
