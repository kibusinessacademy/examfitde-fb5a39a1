import { Link } from 'react-router-dom';
import { FileText, ArrowRight } from 'lucide-react';
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
  { title: 'Bewertung nach HGB', desc: 'Anschaffungs- und Herstellungskosten, Niederstwertprinzip, Imparitätsprinzip, Bewertungsstetigkeit.' },
  { title: 'Bilanz, GuV, Anhang, Lagebericht', desc: 'Gliederung nach §§ 266, 275 HGB, Pflichtangaben, Größenklassen.' },
  { title: 'Bilanzanalyse & Kennzahlen', desc: 'Vermögens-, Finanz- und Ertragslage, Eigenkapitalquote, ROI, Cashflow-Analyse.' },
  { title: 'Konsolidierung (Grundzüge)', desc: 'Vollkonsolidierung, Kapitalkonsolidierung, Schuldenkonsolidierung – häufig in Verbindung mit IFRS geprüft.' },
];

const FEHLER = [
  { title: 'Bewertungsvorschriften vermischen', desc: 'HGB-strenges Niederstwertprinzip vs. IFRS-Fair-Value führen ohne klares Schema zu Punktverlust.' },
  { title: 'Anhang & Lagebericht ignorieren', desc: 'Pflichtangaben werden gerne als „Bonus" abgetan – sind aber regelmäßig prüfungsrelevant.' },
  { title: 'Kennzahlen nur auswendig lernen', desc: 'In der Klausur müssen Kennzahlen interpretiert werden, nicht nur berechnet.' },
];

const FAQS = [
  { question: 'Wie ist der Jahresabschluss-Teil aufgebaut?', answer: 'In der Regel 240 Min. Klausur mit umfangreicher Fallstudie: Bilanzierung, GuV-Erstellung, Bewertung und Bilanzanalyse in einem zusammenhängenden Sachverhalt.' },
  { question: 'Wie wichtig ist Konsolidierung?', answer: 'Grundzüge der Konsolidierung gehören zum Pflichtstoff und werden gerne kombiniert mit IFRS-Fragen geprüft.' },
  { question: 'Welche Hilfsmittel sind erlaubt?', answer: 'I. d. R. Gesetzestexte (HGB, AO, EStG, UStG) und ein nicht-programmierbarer Taschenrechner. Genaue Liste auf der IHK-Einladung.' },
];

export default function BilanzbuchhalterJahresabschlussPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Bilanzbuchhalter', url: `${SITE_URL}/bilanzbuchhalter-pruefungsvorbereitung` },
    { name: 'Jahresabschluss' },
  ];

  return (
    <>
      <SEOHead
        title="Bilanzbuchhalter Jahresabschluss – HGB & GuV"
        description="Jahresabschluss nach HGB für die Bilanzbuchhalter-Prüfung: Bewertung, Bilanz, GuV, Anhang, Lagebericht und Bilanzanalyse mit Kennzahlen."
        canonical={`${SITE_URL}/bilanzbuchhalter-jahresabschluss`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Bilanzbuchhalter', href: '/bilanzbuchhalter-pruefungsvorbereitung' },
              { label: 'Jahresabschluss' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Handlungsbereich 2</Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Bilanzbuchhalter <span className="text-gradient">Jahresabschluss</span> nach HGB
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Bewertung, Bilanz, GuV, Anhang, Lagebericht und Bilanzanalyse – der punktreichste schriftliche Teil der Prüfung.
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
              <Link to="/bilanzbuchhalter-buchhaltung" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Vorher: Buchhaltung</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/bilanzbuchhalter-steuern" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Weiter: Steuern &amp; IFRS</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
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
          label="Bereit für den Jahresabschluss?"
          subtitle={`Mache den Selbsttest, sieh deinen Lernplan und entscheide danach über das Komplettpaket (${PRICING.defaultPrice}).`} />
      </div>
    </>
  );
}
