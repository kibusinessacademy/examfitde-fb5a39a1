import { Link } from 'react-router-dom';
import { ArrowRight, Heart, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Was hilft gegen Prüfungsangst im Studium?', answer: 'Die wichtigsten Strategien: gründliche Vorbereitung mit Übungsklausuren, realistische Prüfungssimulation, Atemtechniken und ein strukturierter Lernplan. ExamFit hilft bei allen vier Punkten.' },
  { question: 'Ist Prüfungsangst normal?', answer: 'Ja – leichte Nervosität ist normal und kann sogar leistungsfördernd wirken. Problematisch wird es, wenn die Angst blockiert. Dann helfen gezielte Strategien und Übung.' },
  { question: 'Kann Klausurtraining gegen Prüfungsangst helfen?', answer: 'Definitiv. Je öfter du unter realistischen Bedingungen übst, desto vertrauter wird die Prüfungssituation und desto geringer die Angst.' },
];

export default function PruefungsangstStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Studium Prüfungsvorbereitung', url: `${SITE_URL}/studium-pruefungsvorbereitung` },
    { name: 'Prüfungsangst Studium' },
  ];

  return (
    <>
      <SEOHead
        title="Prüfungsangst Studium überwinden – Tipps & Strategien"
        description="Klausurangst überwinden: Bewährte Strategien gegen Prüfungsstress im Studium. Mit Übungsklausuren, Atemtechniken und strukturiertem Lernplan."
        canonical={`${SITE_URL}/pruefungsangst-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Studium Vorbereitung', href: '/studium-pruefungsvorbereitung' },
              { label: 'Prüfungsangst Studium' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30"><Heart className="h-3 w-3 mr-1 inline" /> Prüfungsangst</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Prüfungsangst im Studium</span> überwinden
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Klausurangst ist überwindbar – mit den richtigen Strategien, gezieltem Training und einem klaren Plan.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/klausurtraining-studium">Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">5 Strategien gegen <span className="text-gradient">Klausurangst</span></h2>
            <div className="space-y-4">
              {[
                'Realistische Prüfungssimulation: Je vertrauter die Situation, desto weniger Angst',
                'Strukturierter Lernplan: Sicherheit durch klare Vorbereitung',
                'Aktives Üben statt passives Lesen: Wissen abrufbar machen',
                'Atemtechniken & Pausen: Körperliche Entspannung senkt den Stresslevel',
                'Erfolge sichtbar machen: Fortschrittsanzeige gibt Sicherheit',
              ].map(p => (
                <div key={p} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/pruefungsangst-studium" title="Weitere Studium-Themen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur Prüfungsangst</h2>
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
            <h2 className="text-3xl font-display font-bold">Angst besiegen – Klausur bestehen</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
