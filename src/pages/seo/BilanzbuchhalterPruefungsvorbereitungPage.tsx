import { Link } from 'react-router-dom';
import { BookOpen, Calculator, FileText, Target, Clock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { QuizCTA } from '@/components/quiz/QuizCTA';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const QUIZ = 'bilanzbuchhalter-pruefungsreife';
const CLUSTER = 'bibu_cluster';

const HANDLUNGSBEREICHE = [
  { nr: 1, title: 'Geschäftsvorfälle erfassen & Buchführung organisieren', desc: 'Belegwesen, Kontenrahmen IKR/SKR, Umsatzsteuer, Anlagen- und Abschreibungsbuchungen' },
  { nr: 2, title: 'Jahresabschluss erstellen & analysieren', desc: 'Bewertung nach HGB, Bilanz / GuV / Anhang, Bilanzanalyse, Kennzahlen' },
  { nr: 3, title: 'Steuerrecht anwenden', desc: 'Ertragsteuern, Umsatzsteuer, internationales Steuerrecht, Verfahrensrecht' },
  { nr: 4, title: 'Finanzwirtschaftliches Management & internes Kontrollsystem', desc: 'Investition, Finanzierung, Reporting, Controlling, IKS' },
  { nr: 5, title: 'Berichterstattung nach IFRS', desc: 'Internationale Rechnungslegung, Unterschiede HGB ↔ IFRS' },
];

const PRUEFUNGSTEILE = [
  { icon: Calculator, title: 'Buchhaltung & Geschäftsvorfälle', desc: 'IKR/SKR, Umsatzsteuer, Anlagenbuchhaltung – Grundlage für alles Weitere.', href: '/bilanzbuchhalter-buchhaltung' },
  { icon: FileText, title: 'Jahresabschluss', desc: 'Bewertung nach HGB, Bilanz, GuV, Anhang, Lagebericht, Bilanzanalyse.', href: '/bilanzbuchhalter-jahresabschluss' },
  { icon: BookOpen, title: 'Steuern & Reporting', desc: 'Ertragsteuern, USt, IFRS, internes Kontrollsystem, Reporting.', href: '/bilanzbuchhalter-steuern' },
];

const FAQS = [
  { question: 'Wie ist die Bilanzbuchhalter-Prüfung aufgebaut?', answer: 'Die IHK-Prüfung umfasst mehrere schriftliche Teile zu den Handlungsbereichen sowie ein mündliches situationsbezogenes Fachgespräch. Genaue Anzahl, Dauer und Inhalte ergeben sich aus der aktuellen Prüfungsverordnung deiner zuständigen IHK.' },
  { question: 'Welche Bestehensgrenze gilt?', answer: 'Jeder Prüfungsteil muss mindestens mit „ausreichend" bestanden werden. Unter bestimmten Voraussetzungen ist eine mündliche Ergänzungsprüfung möglich – Details regelt die Prüfungsverordnung deiner IHK.' },
  { question: 'Wie lange dauert die Vorbereitung realistisch?', answer: 'Mit ~10 h/Woche solider Vorbereitung benötigen die meisten Kandidat*innen 6–9 Monate. Mit unserem Lernplan, der nach dem Selbsttest individuell angepasst wird, lässt sich das oft auf 4–6 Monate verkürzen.' },
  { question: 'Was kostet die Vorbereitung bei ExamFit?', answer: `Das Bilanzbuchhalter-Komplettpaket kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang – inklusive aller 5 Handlungsbereiche, mündlicher Prüfungssimulation und KI-Coach.` },
  { question: 'Sind IFRS wirklich prüfungsrelevant?', answer: 'Ja. Handlungsbereich 5 (Berichterstattung nach IFRS) wird seit der Reform regelmäßig schriftlich geprüft – häufig in Verbindung mit HGB-Vergleichsfragen. Wer IFRS unterschätzt, scheitert oft an diesem Teil.' },
];

const TYPISCHE_FEHLER = [
  { title: 'IFRS unterschätzen', desc: 'Viele Kandidat*innen bereiten sich nur auf HGB vor und brechen am Tag der IFRS-Klausur ein.' },
  { title: 'Steuerrecht zu kurz lernen', desc: 'Ertragsteuern und USt sind sehr formelnah – ohne strukturierte Wiederholung lässt sich der Teil kaum sicher bestehen.' },
  { title: 'Fallaufgaben nicht trainieren', desc: 'Die Klausuren bestehen fast vollständig aus offenen Fallaufgaben – reines Auswendiglernen reicht nicht. Nur Probeklausuren bringen Routine.' },
  { title: 'Mündliche Prüfung zu spät anfassen', desc: 'Das situationsbezogene Fachgespräch entscheidet über Notenschnitt und Belobigung – wer erst eine Woche vorher übt, verschenkt es.' },
];

export default function BilanzbuchhalterPruefungsvorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Fortbildung', url: `${SITE_URL}/fortbildung` },
    { name: 'Bilanzbuchhalter-Prüfungsvorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="Bilanzbuchhalter IHK – Prüfungsvorbereitung"
        description="Komplette IHK-Bilanzbuchhalter-Vorbereitung: Buchhaltung, Jahresabschluss, Steuern, IFRS und mündliches Fachgespräch. Selbsttest, Lernplan und KI-Coach."
        canonical={`${SITE_URL}/bilanzbuchhalter-pruefungsvorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Fortbildung', href: '/fortbildung' },
              { label: 'Bilanzbuchhalter' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">Bilanzbuchhalter · IHK</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Bilanzbuchhalter-Prüfungsvorbereitung</span>: IHK-Prüfung sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Alle 5 Handlungsbereiche, mündliches Fachgespräch und IFRS – in einem strukturierten Lernpfad mit
                Probeklausuren, Selbsttest und KI-Coach.
              </p>
              <div className="flex flex-wrap gap-4">
                <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="hero" label="Bin ich prüfungsreif? Gratis-Selbsttest" />
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/paket/bilanzbuchhalter-ihk">Komplettpaket ansehen</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Prüfungsstruktur */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-4">
              Aufbau der <span className="text-gradient">Bilanzbuchhalter-Prüfung</span>
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              5 schriftliche Handlungsbereiche + 1 mündliches Fachgespräch. Wir gliedern das Training in drei klare Cluster.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {PRUEFUNGSTEILE.map(teil => (
                <Link key={teil.href} to={teil.href}>
                  <Card className="h-full glass-card hover:border-primary/50 transition-colors group">
                    <CardHeader>
                      <teil.icon className="h-10 w-10 text-primary mb-4" />
                      <CardTitle className="group-hover:text-primary transition-colors">{teil.title}</CardTitle>
                      <CardDescription>{teil.desc}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Mid-CTA */}
        <section className="py-10">
          <div className="container max-w-4xl">
            <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="mid" />
          </div>
        </section>

        {/* Handlungsbereiche */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">
              Die 5 <span className="text-gradient">Handlungsbereiche</span> im Überblick
            </h2>
            <div className="space-y-4">
              {HANDLUNGSBEREICHE.map(hb => (
                <Card key={hb.nr} className="border-border/50">
                  <CardContent className="py-4 flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {hb.nr}
                    </div>
                    <div>
                      <h3 className="font-semibold">{hb.title}</h3>
                      <p className="text-sm text-muted-foreground">{hb.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Typische Fehler */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-2xl font-display font-bold mb-6 text-center">Typische Prüfungsfehler – und wie du sie vermeidest</h2>
            <div className="space-y-3">
              {TYPISCHE_FEHLER.map(f => (
                <Card key={f.title} className="border-border/50">
                  <CardContent className="py-4">
                    <h3 className="font-semibold text-base mb-1">{f.title}</h3>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Steckbrief */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">Bilanzbuchhalter-Prüfung auf einen Blick</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: Clock, label: 'Schriftlich', value: 'Mehrere Klausuren zu den Handlungsbereichen' },
                { icon: BookOpen, label: 'Mündlich', value: 'Situationsbezogenes Fachgespräch' },
                { icon: Target, label: 'Bestehen', value: 'Jeder Teil mindestens „ausreichend"' },
                { icon: FileText, label: 'Grundlage', value: 'Aktuelle Prüfungsverordnung der IHK' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
                  <s.icon className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <span className="text-sm text-muted-foreground">{s.label}</span>
                    <p className="font-medium text-sm">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interne Links */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-xl font-semibold mb-4">Direkt weiterlernen</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Link to={`/quiz/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors flex items-center justify-between">
                <span>5-Fragen-Selbsttest starten</span><ArrowRight className="h-4 w-4 text-primary" />
              </Link>
              <Link to={`/lernplan/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors flex items-center justify-between">
                <span>Persönlichen Lernplan ansehen</span><ArrowRight className="h-4 w-4 text-primary" />
              </Link>
              <Link to="/paket/bilanzbuchhalter-ihk" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors flex items-center justify-between">
                <span>Komplettpaket &amp; Preis</span><ArrowRight className="h-4 w-4 text-primary" />
              </Link>
              <Link to="/pruefungstraining/fachwirt/bilanzbuchhalter" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors flex items-center justify-between">
                <span>Mündliche Prüfungssimulation</span><ArrowRight className="h-4 w-4 text-primary" />
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur Bilanzbuchhalter-Prüfung</h2>
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

        {/* Footer-CTA */}
        <QuizCTA
          quizSlug={QUIZ}
          cluster={CLUSTER}
          location="footer"
          label="Bereit für die Bilanzbuchhalter-Prüfung?"
          subtitle={`Starte mit dem 5-Fragen-Selbsttest, erhalte deinen Lernplan und entscheide danach, ob du das Komplettpaket (${PRICING.defaultPrice}) brauchst.`}
        />
      </div>
    </>
  );
}
