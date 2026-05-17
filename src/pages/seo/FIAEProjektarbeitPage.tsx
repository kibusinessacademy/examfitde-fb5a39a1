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
  { title: 'Projektantrag formulieren', desc: 'Ist-/Soll-Analyse, messbare Ziele, Stundenplanung – Genehmigungs-Schwachstelle Nummer 1.' },
  { title: 'Projektdokumentation (~30 Std.)', desc: 'Aufbau: Einleitung, Analyse, Entwurf, Implementierung, Test, Fazit. Wirtschaftlichkeit nicht vergessen.' },
  { title: 'Präsentation (15 Min.)', desc: 'Roter Faden, Tiefe statt Folienschlacht, Live-Demo nur wenn risikofrei.' },
  { title: 'Fachgespräch (15 Min.)', desc: 'Begründung von Entscheidungen, Trade-offs, alternative Lösungswege.' },
  { title: 'Wirtschaftlichkeit & ROI', desc: 'Make-or-Buy, Amortisationszeit, Projekt­kostenkalkulation.' },
];

const FEHLER = [
  { title: 'Antrag zu vage', desc: 'Ohne messbare Ziele und Stundenplanung gibt es Auflagen oder Ablehnung.' },
  { title: 'Doku zu code-lastig', desc: 'Die IHK will Entscheidungen sehen, nicht Listings – Code-Auszüge sparsam einsetzen.' },
  { title: 'Präsentation zu breit', desc: 'Die kurze Präsentationszeit reicht nur für 1–2 Kern­entscheidungen mit echter Tiefe – Fokus statt Vollständigkeit.' },
  { title: 'Fachgespräch nicht geübt', desc: 'Wer Entscheidungen nicht spontan begründen kann, verschenkt die beste Note.' },
];

const FAQS = [
  { question: 'Wie viele Stunden hat das betriebliche Projekt?', answer: 'Die exakte Bearbeitungszeit regelt die aktuelle Prüfungsverordnung deiner zuständigen IHK – bitte dort vor Antragsstellung prüfen.' },
  { question: 'Wann muss der Projektantrag eingereicht werden?', answer: 'Die exakte Frist gibt deine zuständige IHK vor – meist mehrere Wochen vor Prüfungsbeginn. Wer zu spät einreicht, verschiebt automatisch um einen Termin.' },
  { question: 'Darf KI / Copilot im Projekt eingesetzt werden?', answer: 'Ja, aber transparent. Eingesetzte Tools müssen in der Doku benannt werden und du musst sämtliche Code-Entscheidungen im Fachgespräch selbst erklären können.' },
  { question: 'Wie wichtig ist die Wirtschaftlichkeitsbetrachtung?', answer: 'Sehr wichtig – sie ist Pflichtbestandteil und entscheidet oft, ob die Note „gut" oder „sehr gut" wird.' },
];

export default function FIAEProjektarbeitPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Fachinformatiker AE', url: `${SITE_URL}/fachinformatiker-ae-pruefungsvorbereitung` },
    { name: 'Projektarbeit & Fachgespräch' },
  ];

  return (
    <>
      <SEOHead
        title="FIAE Projektarbeit & Fachgespräch"
        description="FIAE-Abschlussprojekt sicher durchziehen: Projektantrag, Dokumentation, Präsentation und Fachgespräch – mit typischen Fehlerquellen und Coaching-Tipps."
        canonical={`${SITE_URL}/fiae-projektarbeit`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'FIAE', href: '/fachinformatiker-ae-pruefungsvorbereitung' },
              { label: 'Projekt + Fachgespräch' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Projekt · 30 h · 15+15 Min.</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                FIAE <span className="text-gradient">Projektarbeit & Fachgespräch</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Antrag, Doku, Präsentation und Fachgespräch – der Bereich mit dem größten Hebel für deine Endnote.
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
              <Link to="/pruefungstraining/fachinformatiker-ae" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Mündliche Prüfungssimulation</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/paket/fachinformatiker-anwendungsentwicklung" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Komplettpaket</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
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
          label="Bereit für Projekt & Fachgespräch?"
          subtitle={`Mache den Selbsttest, sieh deinen Lernplan und entscheide danach über das Komplett-Bundle (${PRICING.defaultPrice}).`} />
      </div>
    </>
  );
}
