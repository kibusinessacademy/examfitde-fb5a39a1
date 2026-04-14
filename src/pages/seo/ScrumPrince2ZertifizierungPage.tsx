import { Link } from 'react-router-dom';
import { ArrowRight, Award, BookOpen, Brain, Target, Shield, Layers } from 'lucide-react';
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
  { title: 'PSM I Vorbereitung', desc: 'Professional Scrum Master I Prüfung bestehen', href: '/scrum-psm-vorbereitung', icon: Award },
  { title: 'CSM Training', desc: 'Certified Scrum Master Kurs & Schulung', href: '/scrum-csm-training', icon: BookOpen },
  { title: 'PRINCE2 Foundation', desc: 'PRINCE2 Foundation Online-Prüfung vorbereiten', href: '/prince2-foundation', icon: Shield },
  { title: 'PRINCE2 Practitioner', desc: 'PRINCE2 Practitioner Prozesse & Anwendung', href: '/prince2-practitioner', icon: Layers },
  { title: 'Scrum vs. PRINCE2', desc: 'Agile vs. strukturiert – der Vergleich', href: '/scrum-prince2-vergleich', icon: Target },
];

const FAQS = [
  { question: 'Was ist der Unterschied zwischen Scrum und PRINCE2?', answer: 'Scrum ist ein agiles Framework für iterative Produktentwicklung mit Sprints. PRINCE2 ist eine strukturierte Projektmanagement-Methode mit definierten Phasen, Rollen und Prozessen. Beide können kombiniert werden (PRINCE2 Agile).' },
  { question: 'Welche Scrum-Zertifizierung ist besser: PSM I oder CSM?', answer: 'PSM I (Scrum.org) erfordert keine Schulung und testet tiefes Scrum-Guide-Wissen. CSM (Scrum Alliance) setzt einen 2-Tage-Kurs voraus. PSM I gilt als anspruchsvoller, CSM bietet Community-Zugang.' },
  { question: 'Wie bereite ich mich auf die PRINCE2 Foundation-Prüfung vor?', answer: 'Lerne die 7 Prinzipien, 7 Themes und 7 Prozesse. Nutze offizielle Handbücher plus Übungsfragen. Die Prüfung hat 60 Multiple-Choice-Fragen (55% zum Bestehen). ExamFit bietet prüfungsnahe Simulation.' },
  { question: 'Was kostet das Zertifizierungstraining bei ExamFit?', answer: `ExamFit kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang. Scrum- und PRINCE2-Module inklusive: Prüfungsfragen, Simulation und KI-Coach.` },
];

export default function ScrumPrince2ZertifizierungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Scrum & PRINCE2 Zertifizierung' },
  ];

  return (
    <>
      <SEOHead
        title="Scrum & PRINCE2 Zertifizierung – Vorbereitung, Prüfung & Training | ExamFit"
        description="Scrum PSM I, CSM und PRINCE2 Foundation/Practitioner Zertifizierung vorbereiten. Prüfungsfragen, Simulation und KI-Coach für Projektmanagement-Profis."
        canonical={`${SITE_URL}/scrum-prince2-zertifizierung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Scrum & PRINCE2 Zertifizierung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Projektmanagement-Zertifizierungen</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Scrum & PRINCE2</span> Zertifizierung sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Professionelle Prüfungsvorbereitung für PSM I, CSM, PRINCE2 Foundation und Practitioner – mit prüfungsnahen Fragen, realistischer Simulation und KI-Coach.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild><Link to="/projektmanagement/scrum">Scrum-Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
                <Button size="lg" variant="outline" asChild><Link to="/projektmanagement/prince2">PRINCE2-Training starten</Link></Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container">
            <h2 className="text-3xl font-display font-bold mb-8 text-center">Zertifizierungen im Überblick</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {CLUSTERS.map(c => (
                <Link key={c.href} to={c.href}>
                  <Card className="h-full hover:shadow-lg transition-shadow border-border/50">
                    <CardContent className="p-6">
                      <c.icon className="h-8 w-8 text-primary mb-3" />
                      <h3 className="font-semibold text-lg mb-2">{c.title}</h3>
                      <p className="text-sm text-muted-foreground">{c.desc}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-6">Scrum vs. PRINCE2: Welches Zertifikat passt zu dir?</h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-xl font-semibold flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Scrum (Agil)</h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• Iterative Sprints (1–4 Wochen)</li>
                  <li>• Selbstorganisierte Teams</li>
                  <li>• Fokus auf Produktentwicklung</li>
                  <li>• PSM I: 80 Fragen, 60 Min., 85%</li>
                  <li>• Keine Schulungspflicht für PSM</li>
                </ul>
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-semibold flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> PRINCE2 (Strukturiert)</h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• Definierte Phasen & Prozesse</li>
                  <li>• Klare Rollenverteilung</li>
                  <li>• Fokus auf Projektsteuerung</li>
                  <li>• Foundation: 60 Fragen, 60 Min., 55%</li>
                  <li>• Akkreditierter Kurs empfohlen</li>
                </ul>
              </div>
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
            <SEOInternalLinks sourceUrl="/scrum-prince2-zertifizierung" linkTypes={['pillar_to_cluster']} title="Zertifizierungen vertiefen" />
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-display font-bold mb-8">Häufige Fragen zu Scrum & PRINCE2</h2>
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

        <section className="py-16">
          <div className="container max-w-3xl">
            <SEOInternalLinks sourceUrl="/scrum-prince2-zertifizierung" linkTypes={['cluster_to_product']} title="Jetzt Training starten" />
          </div>
        </section>
      </div>
    </>
  );
}
