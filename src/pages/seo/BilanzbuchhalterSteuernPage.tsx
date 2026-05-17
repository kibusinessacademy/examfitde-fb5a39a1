import { Link } from 'react-router-dom';
import { BookOpen, ArrowRight } from 'lucide-react';
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
  { title: 'Ertragsteuern (ESt, KSt, GewSt)', desc: 'Einkunftsarten, Gewinnermittlung, Hinzurechnungen/Kürzungen, Körperschaftsteuer-System, Gewerbesteuer-Messzahl.' },
  { title: 'Umsatzsteuer (vertieft)', desc: 'Innergemeinschaftliche Geschäfte, Reverse-Charge, Voranmeldung, Vorsteuerabzug, Kleinunternehmerregelung.' },
  { title: 'Internationale Rechnungslegung – IFRS', desc: 'Konzeptioneller Rahmen, IFRS 15 (Erlöse), IFRS 16 (Leasing), IAS 36 (Wertminderung), Unterschiede zu HGB.' },
  { title: 'Internes Kontrollsystem & Reporting', desc: 'IKS-Aufbau, Tax Compliance, Management-Reporting, Kennzahlensteuerung.' },
];

const FEHLER = [
  { title: 'IFRS auf den letzten Drücker lernen', desc: 'IFRS-Aufgaben sind formelnah und prüfen Verständnis – ohne mehrere Wochen gezieltes Training fehlt es schnell an Routine.' },
  { title: 'GewSt-Hinzurechnungen vergessen', desc: 'Gerade § 8 Nr. 1 GewStG (Finanzierungsanteile) wird gerne übersehen.' },
  { title: 'IKS als Theorie abtun', desc: 'IKS-Fragen kommen häufig im mündlichen Fachgespräch und im 4. Handlungsbereich.' },
];

const FAQS = [
  { question: 'Welche Steuergesetze sind in der Klausur erlaubt?', answer: 'Üblicherweise EStG, KStG, GewStG, UStG, AO inklusive Durchführungsverordnungen – jeweils unkommentierte Textausgaben. Genaue Liste über die IHK-Einladung.' },
  { question: 'Welche Rolle spielt der IFRS-Teil?', answer: 'Die Berichterstattung nach IFRS (Handlungsbereich 5) ist regelmäßig Bestandteil der schriftlichen Prüfung und gewichtet vergleichbar zu den anderen Klausuren. Exakte Punkte und Bearbeitungszeit regelt die aktuelle Prüfungsverordnung deiner IHK.' },
  { question: 'Brauche ich Steuerberater-Niveau?', answer: 'Nein – aber ein sicheres Anwenderniveau auf das in der Verordnung benannte Stoffgebiet. Spezialfälle (z. B. Umwandlungssteuerrecht) sind nicht Pflicht.' },
];

export default function BilanzbuchhalterSteuernPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Bilanzbuchhalter', url: `${SITE_URL}/bilanzbuchhalter-pruefungsvorbereitung` },
    { name: 'Steuern & IFRS' },
  ];

  return (
    <>
      <SEOHead
        title="Bilanzbuchhalter Steuerrecht & IFRS"
        description="Steuerrecht und internationale Rechnungslegung für die Bilanzbuchhalter-Prüfung: ESt, KSt, GewSt, USt, IFRS 15/16, IAS 36 und internes Kontrollsystem."
        canonical={`${SITE_URL}/bilanzbuchhalter-steuern`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Bilanzbuchhalter', href: '/bilanzbuchhalter-pruefungsvorbereitung' },
              { label: 'Steuern & IFRS' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Handlungsbereiche 3 & 5</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Bilanzbuchhalter <span className="text-gradient">Steuerrecht & IFRS</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Ertragsteuern, USt, internationale Rechnungslegung und IKS – die punktreichen Querschnittsthemen der Prüfung.
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
              <Link to="/bilanzbuchhalter-jahresabschluss" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Vorher: Jahresabschluss</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/pruefungstraining/fachwirt/bilanzbuchhalter" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Mündliche Prüfungssimulation</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
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
          label="Bereit für Steuerrecht & IFRS?"
          subtitle={`Mache den Selbsttest, sieh deinen Lernplan und entscheide danach über das Komplettpaket (${PRICING.defaultPrice}).`} />
      </div>
    </>
  );
}
