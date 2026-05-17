import { Link } from 'react-router-dom';
import { Calculator, ArrowRight, Clock, Target, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { QuizCTA } from '@/components/quiz/QuizCTA';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const QUIZ = 'bilanzbuchhalter-pruefungsreife';
const CLUSTER = 'bibu_cluster';

const THEMEN = [
  { title: 'Belegwesen & Kontenrahmen (IKR/SKR03/SKR04)', desc: 'Sauberes Buchen aus Belegen, Kontensystematik nach IKR und SKR – Basis aller Klausuren.' },
  { title: 'Umsatzsteuer (Inland, EU, Drittland)', desc: 'Steuerbarkeit, Steuerbefreiungen, Reverse-Charge, innergemeinschaftliche Lieferungen, USt-Voranmeldung.' },
  { title: 'Anlagenbuchhaltung & Abschreibungen', desc: 'Aktivierung, AfA-Methoden, GWG, geringwertige Sammelposten, planmäßige und außerplanmäßige Abschreibung.' },
  { title: 'Personal & Lohnbuchhaltung', desc: 'Lohnnebenkosten, Sozialversicherung, geldwerter Vorteil, Reisekosten.' },
  { title: 'Rückstellungen, RAP, Forderungen', desc: 'Bewertung, Abgrenzungen, Einzel- und Pauschalwertberichtigungen.' },
];

const FEHLER = [
  { title: 'USt-Sachverhalte verwechseln', desc: 'Innergemeinschaftliche Lieferung vs. Ausfuhr vs. Reverse-Charge – ohne klares Schema werden hier reihenweise Punkte liegen gelassen.' },
  { title: 'AfA-Methoden nicht sicher anwenden', desc: 'Gerade Halbjahres-/Restwert-Themen werden in Klausuren bewusst trickreich gestellt.' },
  { title: 'Belegfluss nicht buchen können', desc: 'Wer nur Konten auswendig kennt, scheitert an „echten" Geschäftsvorfällen mit mehreren Schritten.' },
];

const FAQS = [
  { question: 'Welche Rolle spielt die Buchhaltung in der Prüfung?', answer: 'Der schriftliche Teil zu Geschäftsvorfällen und Buchführung ist eine zentrale Grundlage für Jahresabschluss und Steuern. Genaue Punkte und Bearbeitungszeit ergeben sich aus der aktuellen Prüfungsverordnung deiner IHK.' },
  { question: 'Welcher Kontenrahmen wird geprüft?', answer: 'Die IHK-Prüfung verwendet primär den IKR (Industriekontenrahmen). SKR03/SKR04 werden in der Praxis genutzt, in der Klausur wird ein Kontenplan i. d. R. mitgegeben.' },
  { question: 'Reicht es, nur die Buchungssätze zu üben?', answer: 'Nein – die Klausur prüft komplette Geschäftsvorfälle inklusive USt, Abschreibungen und teilweise Folgewirkungen auf den Jahresabschluss. Ohne integriertes Üben bleibt es Stückwerk.' },
];

export default function BilanzbuchhalterBuchhaltungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Bilanzbuchhalter', url: `${SITE_URL}/bilanzbuchhalter-pruefungsvorbereitung` },
    { name: 'Buchhaltung & Geschäftsvorfälle' },
  ];

  return (
    <>
      <SEOHead
        title="Bilanzbuchhalter Buchhaltung & Geschäftsvorfälle"
        description="Buchhaltung, Umsatzsteuer, Anlagenbuchhaltung, Lohn & Rückstellungen – der erste Handlungsbereich der Bilanzbuchhalter-Prüfung sicher vorbereitet."
        canonical={`${SITE_URL}/bilanzbuchhalter-buchhaltung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Bilanzbuchhalter', href: '/bilanzbuchhalter-pruefungsvorbereitung' },
              { label: 'Buchhaltung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Handlungsbereich 1</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Bilanzbuchhalter <span className="text-gradient">Buchhaltung & Geschäftsvorfälle</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                IKR/SKR, Umsatzsteuer, Anlagenbuchhaltung, Personal und Rückstellungen – die Pflichtbasis für alle weiteren Klausuren.
              </p>
              <div className="flex flex-wrap gap-4">
                <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="hero" label="Stand prüfen: Selbsttest starten" />
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/bilanzbuchhalter-pruefungsvorbereitung">Zurück zum Pillar</Link>
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
              <Link to="/bilanzbuchhalter-jahresabschluss" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Weiter: Jahresabschluss</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/paket/bilanzbuchhalter-ihk" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Komplettpaket</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
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
          label="Bereit für Buchhaltung & Geschäftsvorfälle?"
          subtitle={`Mache den Selbsttest, sieh deinen Lernplan und entscheide danach über das Komplettpaket (${PRICING.defaultPrice}).`} />
      </div>
    </>
  );
}
