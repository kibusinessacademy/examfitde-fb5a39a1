import { Link } from 'react-router-dom';
import { Briefcase, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { QuizCTA } from '@/components/quiz/QuizCTA';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const QUIZ = 'fiae-pruefungsreife';
const CLUSTER = 'fiae_cluster';

const THEMEN = [
  { title: 'Vertrags- und Kaufrecht', desc: 'Vertragsarten, Mängelrechte, Verzug, AGB – häufig in Fallaufgaben.' },
  { title: 'Arbeitsrecht', desc: 'Arbeitsvertrag, Kündigungsschutz, Arbeitszeit, Urlaub, Mitbestimmung.' },
  { title: 'Sozialversicherung & Lohn', desc: 'Beitragsbemessung, SV-Zweige, Lohnabrechnung-Basics.' },
  { title: 'Wirtschaftliches Handeln', desc: 'Rechtsformen, Marketing-Grundlagen, Kostenrechnung-Basics.' },
  { title: 'Datenschutz (DSGVO)', desc: 'Verantwortlicher vs. Auftragsverarbeiter, Betroffenenrechte, TOMs.' },
];

const FEHLER = [
  { title: 'WiSo „mit links" lernen', desc: 'Viele unterschätzen GA2 – Fehlpunkte hier kosten am Ende ganze Notenstufen.' },
  { title: 'Fallaufgaben ohne Begründung', desc: 'Antworten ohne Bezug zum Sachverhalt geben kaum Punkte – immer Norm + Sachverhalt + Schluss.' },
  { title: 'Datenschutz unterschätzen', desc: 'DSGVO-Themen werden regelmäßig geprüft – ein verlässlicher Punktebringer mit überschaubarem Lernaufwand.' },
];

const FAQS = [
  { question: 'Wie ist GA2 aufgebaut?', answer: 'Mischung aus gebundenen (MC) und ungebundenen (offenen) Aufgaben. Genaue Bearbeitungszeit regelt die aktuelle Prüfungsverordnung deiner IHK.' },
  { question: 'Welche Themen kommen am häufigsten?', answer: 'Arbeitsrecht, Vertragsrecht, Datenschutz und Grundlagen wirtschaftlichen Handelns sind in jeder Prüfung vertreten.' },
  { question: 'Reicht es, ein Buch durchzuarbeiten?', answer: 'Nein – ohne aktive Fall-Übungen bleibt das Wissen passiv. Genau deshalb arbeitet unser Lernplan mit Übungsfällen pro Themenblock.' },
];

export default function FIAEWiSoPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Fachinformatiker AE', url: `${SITE_URL}/fachinformatiker-ae-pruefungsvorbereitung` },
    { name: 'Wirtschafts- und Sozialkunde (GA2)' },
  ];

  return (
    <>
      <SEOHead
        title="FIAE GA2 WiSo – Prüfungsvorbereitung"
        description="WiSo (GA2) für die FIAE-Abschlussprüfung Teil 2: Vertragsrecht, Arbeitsrecht, SV, DSGVO und wirtschaftliches Handeln – fallorientiert vorbereitet."
        canonical={`${SITE_URL}/fiae-wiso`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'FIAE', href: '/fachinformatiker-ae-pruefungsvorbereitung' },
              { label: 'GA2 WiSo' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">GA2 · 60 Min.</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                FIAE <span className="text-gradient">WiSo (GA2)</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Vertrag, Arbeit, Sozialversicherung, DSGVO und wirtschaftliches Handeln – fallorientiert vorbereitet.
              </p>
              <div className="flex flex-wrap gap-4">
                <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="hero" label="Stand prüfen: Selbsttest starten" />
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/fachinformatiker-ae-pruefungsvorbereitung">Zurück zum Pillar</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Themenblöcke</h2>
            <div className="space-y-3">
              {THEMEN.map(t => (
                <Card key={t.title} className="border-border/50"><CardContent className="py-4">
                  <h3 className="font-semibold">{t.title}</h3>
                  <p className="text-sm text-muted-foreground">{t.desc}</p>
                </CardContent></Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-10"><div className="container max-w-4xl"><QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="mid" /></div></section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-2xl font-display font-bold mb-6 text-center">Typische Prüfungsfehler</h2>
            <div className="space-y-3">
              {FEHLER.map(f => (
                <Card key={f.title} className="border-border/50"><CardContent className="py-4">
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent></Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <h2 className="text-xl font-semibold mb-4">Direkt weiterlernen</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Link to={`/quiz/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>5-Fragen-Selbsttest</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to={`/lernplan/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Persönlicher Lernplan</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/fiae-anwendungsentwicklung" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Vorher: GA1 Anwendungsentwicklung</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/fiae-projektarbeit" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Weiter: Projekt + Fachgespräch</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen</h2>
            <div className="space-y-3">
              {FAQS.map(f => (
                <details key={f.question} className="group border border-border rounded-lg bg-card">
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary">{f.question}</summary>
                  <p className="px-6 pb-4 text-sm text-muted-foreground">{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="footer"
          label="Bereit für GA2 WiSo?"
          subtitle={`Mache den Selbsttest, sieh deinen Lernplan und entscheide danach über das Komplettpaket (${PRICING.defaultPrice}).`} />
      </div>
    </>
  );
}
