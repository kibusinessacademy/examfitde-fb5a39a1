import { Link } from 'react-router-dom';
import { ArrowRight, Calendar, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const FAQS = [
  { question: 'Wie erstelle ich einen Lernplan für die Klausur?', answer: 'Teile den Stoff in Wochenblöcke, plane aktive Wiederholung (Spaced Repetition) ein und setze Übungsklausuren als Meilensteine. ExamFit erstellt deinen Lernplan automatisch.' },
  { question: 'Wie viel Zeit brauche ich für die Klausurvorbereitung?', answer: 'Empfehlung: mindestens 3–4 Wochen bei 2–3 Stunden täglich. Der KI-Coach passt den Zeitplan an deinen Wissensstand an.' },
  { question: 'Was ist Spaced Repetition?', answer: 'Eine Lernmethode, bei der Inhalte in steigenden Abständen wiederholt werden. So wird Wissen langfristig verankert statt nur kurzfristig gepaukt.' },
];

export default function LernplanStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Studium Prüfungsvorbereitung', url: `${SITE_URL}/studium-pruefungsvorbereitung` },
    { name: 'Lernplan Studium' },
  ];

  return (
    <>
      <SEOHead
        title="Lernplan Studium – Effektiv für Klausuren lernen"
        description="Erstelle deinen Lernplan für die Klausur: Spaced Repetition, Zeitmanagement und KI-gestützte Planung. Lerne effektiver für dein Studium!"
        canonical={`${SITE_URL}/lernplan-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Studium Vorbereitung', href: '/studium-pruefungsvorbereitung' },
              { label: 'Lernplan Studium' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30"><Calendar className="h-3 w-3 mr-1 inline" /> Lernplan</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Lernplan Studium</span>: Effektiv für Klausuren lernen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Strukturiert, effizient und stressfrei – mit dem richtigen Lernplan bestehst du jede Klausur.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">Lernplan erstellen <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">So baust du den <span className="text-gradient">perfekten Lernplan</span></h2>
            <div className="space-y-4">
              {[
                'Überblick verschaffen: Welche Themen sind prüfungsrelevant?',
                'Stoffmenge einteilen: Wochenblöcke mit klaren Lernzielen',
                'Aktiv lernen: Übungsfragen statt passives Lesen',
                'Spaced Repetition: Wiederholung in steigenden Abständen',
                'Klausursimulation: Probeprüfung als Meilenstein',
                'Puffer einplanen: Lücken und Wiederholung berücksichtigen',
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
            <SEOInternalLinks sourceUrl="/lernplan-studium" title="Weitere Studium-Themen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Lernplan</h2>
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
            <h2 className="text-3xl font-display font-bold">Dein persönlicher Lernplan wartet</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
