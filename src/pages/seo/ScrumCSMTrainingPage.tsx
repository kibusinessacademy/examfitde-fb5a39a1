import { Link } from 'react-router-dom';
import { ArrowRight, Users, Clock, Award, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Was ist der CSM (Certified Scrum Master)?', answer: 'Der CSM ist eine Zertifizierung der Scrum Alliance. Er setzt einen 2-tägigen Kurs bei einem zertifizierten Scrum Trainer voraus. Nach dem Kurs absolvierst du einen Online-Test (50 Fragen, 37 richtig zum Bestehen).' },
  { question: 'Wie unterscheidet sich CSM von PSM I?', answer: 'CSM erfordert einen Kurs (ca. 1.000–1.500€), PSM I kann ohne Kurs abgelegt werden (~200 USD). PSM I ist inhaltlich anspruchsvoller (85% vs. 74%), CSM bietet Community-Zugang und Networking.' },
  { question: 'Wie bereite ich mich auf die CSM-Prüfung vor?', answer: 'Besuche den 2-Tage-Kurs, arbeite den Scrum Guide durch und übe mit prüfungsnahen Fragen bei ExamFit. Der Test ist nach dem Kurs gut machbar, wenn du die Grundkonzepte verstehst.' },
];

export default function ScrumCSMTrainingPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Scrum & PRINCE2', url: `${SITE_URL}/scrum-prince2-zertifizierung` },
    { name: 'CSM Training' },
  ];

  return (
    <>
      <SEOHead
        title="CSM Scrum Master Training – Certified Scrum Master Kurs & Prüfung | ExamFit"
        description="CSM Zertifizierung: Alles zum Certified Scrum Master Kurs, 2-Tage-Schulung und Prüfungsvorbereitung. Vergleich CSM vs PSM I und Übungsfragen."
        canonical={`${SITE_URL}/scrum-csm-training`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Scrum & PRINCE2', href: '/scrum-prince2-zertifizierung' },
              { label: 'CSM Training' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Scrum Alliance</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">CSM Scrum Master</span> Training & Zertifizierung
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Certified Scrum Master: 2-Tage-Kurs, Community-Zugang und prüfungsnahe Vorbereitung mit ExamFit.
              </p>
              <Button size="lg" asChild><Link to="/projektmanagement/scrum">Scrum-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">CSM auf einen Blick</h2>
            <div className="grid md:grid-cols-4 gap-6">
              {[
                { icon: Clock, title: '2 Tage', desc: 'Präsenz- oder Online-Kurs' },
                { icon: BookOpen, title: '50 Fragen', desc: 'Online-Test nach dem Kurs' },
                { icon: Users, title: '74% Bestehen', desc: '37 von 50 richtig nötig' },
                { icon: Award, title: '2 Jahre', desc: 'Gültigkeit, dann Renewal' },
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
          <div className="container max-w-3xl">
            <SEOQuizWidget certificationSlug="scrum" title="Scrum-Wissen testen" maxQuestions={5} />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/scrum-csm-training" title="Verwandte Zertifizierungen" />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zum CSM</h2>
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
