import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Wie bereite ich mich auf eine mündliche Prüfung vor?', answer: 'Übe das Erklären von Themen laut, simuliere Frage-Antwort-Situationen und bereite eine klare Struktur für deine Antworten vor. ExamFit bietet Fachgespräch-Simulation dafür.' },
  { question: 'Was sind typische Fragen in mündlichen Prüfungen?', answer: 'Verständnisfragen, Transferfragen und Anwendungsbeispiele. Du solltest nicht nur Fakten kennen, sondern Zusammenhänge erklären können.' },
  { question: 'Wie verteidigt man eine Seminararbeit?', answer: 'Kenne deine Arbeit im Detail, bereite eine kurze Zusammenfassung vor und übe Antworten auf kritische Fragen zu Methodik und Ergebnissen.' },
];

export default function MuendlichePruefungStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Studium Prüfungsvorbereitung', url: `${SITE_URL}/studium-pruefungsvorbereitung` },
    { name: 'Mündliche Prüfung Studium' },
  ];

  return (
    <>
      <SEOHead
        title="Mündliche Prüfung Studium vorbereiten – Tipps & Übungen"
        description="Mündliche Klausur und Seminararbeit-Verteidigung vorbereiten: Fachgespräch-Simulation, Beispielfragen und bewährte Strategien für dein Studium."
        canonical={`${SITE_URL}/muendliche-pruefung-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Studium Vorbereitung', href: '/studium-pruefungsvorbereitung' },
              { label: 'Mündliche Prüfung Studium' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30"><MessageSquare className="h-3 w-3 mr-1 inline" /> Mündliche Prüfung</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Mündliche Prüfung Studium</span>: Sicher vorbereiten
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Fachgespräch, Kolloquium und Seminararbeit-Verteidigung – trainiere gezielt für mündliche Prüfungen im Studium.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">Mündliche Prüfung trainieren <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">So bereitest du dich auf die <span className="text-gradient">mündliche Prüfung</span> vor</h2>
            <div className="space-y-4">
              {[
                'Themen laut erklären – nicht nur lesen, sondern sprechen üben',
                'Frage-Antwort-Simulation mit typischen Prüferfragen',
                'Klare Antwortstruktur: These → Begründung → Beispiel',
                'Seminararbeit im Detail kennen und kritische Punkte vorbereiten',
                'Körpersprache und Stimmführung bewusst einsetzen',
                'Zeitmanagement: Antworten auf den Punkt bringen',
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
            <SEOInternalLinks sourceUrl="/muendliche-pruefung-studium" title="Weitere Studium-Themen" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur mündlichen Prüfung</h2>
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
            <h2 className="text-3xl font-display font-bold">Mündliche Prüfung meistern</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Training starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
