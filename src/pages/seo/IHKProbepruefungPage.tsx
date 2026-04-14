import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Timer, Target, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { SEOQuizWidget } from '@/components/seo/SEOQuizWidget';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Was ist eine IHK-Probeprüfung?', answer: 'Eine Probeprüfung simuliert die echte IHK-Prüfung unter realistischen Bedingungen: gleiche Zeitvorgaben, prüfungskonforme Aufgabentypen und Bestehensindikator. So erkennst du Schwächen vor der echten Prüfung.' },
  { question: 'Wie realistisch ist die Prüfungssimulation?', answer: 'ExamFit bildet die IHK-Prüfung so genau wie möglich nach: gleiche Fragenanzahl, Zeitdruck, Schwierigkeitsverteilung und Bestehensgrenze. Nach der Simulation siehst du deine Ergebnisse aufgeschlüsselt nach Lernfeldern.' },
];

export default function IHKProbepruefungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'IHK-Prüfungsvorbereitung', url: `${SITE_URL}/ihk-pruefungsvorbereitung` },
    { name: 'IHK-Probeprüfung' },
  ];

  return (
    <>
      <SEOHead
        title="IHK-Probeprüfung online – Prüfungssimulation mit Auswertung | ExamFit"
        description="IHK-Probeprüfung online machen: Realistische Prüfungssimulation mit Zeitvorgabe, Bestehensindikator und Lernfeld-Auswertung. Jetzt kostenlos testen!"
        canonical={`${SITE_URL}/ihk-probepruefung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'IHK-Prüfungsvorbereitung', href: '/ihk-pruefungsvorbereitung' },
              { label: 'Probeprüfung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">IHK · Probeprüfung</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">IHK-Probeprüfung</span> online simulieren
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Realistische IHK-Prüfungssimulation mit echtem Zeitdruck, prüfungskonformen Aufgaben und detaillierter Auswertung.
              </p>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/shop">Probeprüfung starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl grid sm:grid-cols-3 gap-4">
            {[
              { icon: Timer, label: 'Echte Zeitvorgabe', desc: 'Gleiche Prüfungsdauer wie bei der IHK' },
              { icon: Target, label: 'Bestehensindikator', desc: 'Sofortige Auswertung nach Bestehensquote' },
              { icon: BarChart3, label: 'Lernfeld-Analyse', desc: 'Schwächen pro Themengebiet erkennen' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="py-6 text-center space-y-3">
                  <s.icon className="h-10 w-10 mx-auto text-primary" />
                  <h3 className="font-semibold">{s.label}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">So funktioniert die Probeprüfung</h2>
            <div className="space-y-3">
              {[
                'Wähle deine Prüfung (z. B. Kaufmann/-frau, Fachwirt, AEVO)',
                'Starte die Simulation unter realistischen Bedingungen',
                'Beantworte prüfungskonforme Fragen im Zeitlimit',
                'Erhalte sofort dein Ergebnis mit Bestehensindikator',
                'Analysiere Schwächen pro Lernfeld und trainiere gezielt nach',
              ].map((t, i) => (
                <div key={t} className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                  <span className="text-sm">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Mini-Quiz */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOQuizWidget
              title="Mini-Probeprüfung"
              subtitle="5 Fragen – wie bestehst du?"
              certificationSlug="aevo"
              ctaText="Vollständige Probeprüfung starten"
              ctaLink="/shop"
            />
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks sourceUrl="/ihk-probepruefung" title="Weitere IHK-Prüfungsvorbereitung" />
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur IHK-Probeprüfung</h2>
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
            <h2 className="text-3xl font-display font-bold">Bereit für die Probeprüfung?</h2>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Probeprüfung starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
