import { Link } from 'react-router-dom';
import { Code2, Database, Briefcase, Target, Clock, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { QuizCTA } from '@/components/quiz/QuizCTA';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';

const QUIZ = 'fiae-pruefungsreife';
const CLUSTER = 'fiae_cluster';

const PRUEFUNGSTEILE = [
  { icon: Code2, title: 'GA1 – Anwendungsentwicklung', desc: 'Entwicklung & Umsetzung von Algorithmen, OOP, Schnittstellen, SQL, Sicherheitsaspekte.', href: '/fiae-anwendungsentwicklung' },
  { icon: Database, title: 'GA2 – Wirtschafts- und Sozialkunde', desc: 'Vertragsrecht, Arbeitsrecht, Datenschutz, Wirtschaftliches Handeln im Betrieb.', href: '/fiae-wiso' },
  { icon: Briefcase, title: 'Betriebliches Projekt + Fachgespräch', desc: 'Projektantrag, Dokumentation, Präsentation und Fachgespräch — Bearbeitungszeit gemäß aktueller IHK-Verordnung.', href: '/fiae-projektarbeit' },
];

const HANDLUNGSFELDER = [
  { nr: 1, title: 'Kunden­spezifische Anwendungsentwicklung', desc: 'Anforderungsanalyse, Konzeption, Implementierung in einer höheren Programmiersprache' },
  { nr: 2, title: 'Daten­modellierung & Datenbankzugriff', desc: 'ER-Modell, Normalisierung, SQL (DDL/DML/DCL), ORM-Grundlagen' },
  { nr: 3, title: 'Software-Architektur & Schnittstellen', desc: 'Schichtenarchitektur, REST, Authentifizierung, Caching, Performance' },
  { nr: 4, title: 'IT-Sicherheit & Datenschutz', desc: 'OWASP-Top-10-Awareness, DSGVO, Verschlüsselung, sichere Authentifizierung' },
  { nr: 5, title: 'Qualitäts­sicherung & Test', desc: 'Unit-/Integrationstests, Code-Reviews, CI/CD-Grundlagen' },
];

const FAQS = [
  { question: 'Wie ist die FIAE-Abschlussprüfung Teil 2 aufgebaut?', answer: 'Sie besteht aus zwei schriftlichen Prüfungsbereichen (GA1 Anwendungsentwicklung 90 Min., GA2 WiSo 60 Min.) sowie einem betrieblichen Projekt (~30 Std.) inklusive Dokumentation, Präsentation (15 Min.) und Fachgespräch (15 Min.).' },
  { question: 'Welche Programmiersprache wird in der Klausur verwendet?', answer: 'Pseudocode oder eine selbstgewählte verbreitete Sprache (z. B. Java, C#, Python). Wichtig ist Lesbarkeit und korrekte Syntax in der gewählten Sprache.' },
  { question: 'Was zählt mehr: Klausur oder Projekt?', answer: 'Beide Bereiche müssen mindestens „ausreichend" sein. Das betriebliche Projekt + Fachgespräch hat besonders hohes Gewicht für die Gesamtnote – wer hier glänzt, bekommt sehr gute Endnoten.' },
  { question: 'Wie lange dauert die Vorbereitung realistisch?', answer: 'Die meisten Azubis beginnen 3–6 Monate vor der Prüfung mit gezielter Wiederholung. Mit dem Selbsttest siehst du in 2 Min., wo du wirklich stehst – und unser Lernplan priorisiert genau die Lücken.' },
  { question: 'Was kostet die Vorbereitung bei ExamFit?', answer: `Das FIAE-Komplettpaket kostet ${PRICING.defaultPrice} einmalig (${PRICING.noSubscription.toLowerCase()}) für ${PRICING.defaultAccess} Zugang – mit allen Handlungsfeldern, Probeklausuren, Projekt-Coaching und Fachgespräch-Simulation.` },
];

const TYPISCHE_FEHLER = [
  { title: 'SQL nur lesen, nicht schreiben', desc: 'In GA1 müssen JOINs, GROUP BY, Subqueries und DDL aktiv geschrieben werden – nicht nur erkannt.' },
  { title: 'WiSo unterschätzen', desc: 'GA2 entscheidet oft über 1–2 Notenstufen – Vertrags- und Arbeitsrecht solide lernen.' },
  { title: 'Projektantrag zu vage formulieren', desc: 'Wer den Antrag nicht messbar formuliert (Stunden, Soll/Ist, Zielsystem), bekommt Auflagen oder Ablehnung.' },
  { title: 'Fachgespräch nicht simulieren', desc: 'Im Fachgespräch zählt freies Sprechen über Entscheidungen – nicht Auswendig-Vortrag der Doku.' },
];

export default function FIAEPruefungsvorbereitungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Fachinformatiker AE-Prüfungsvorbereitung' },
  ];

  return (
    <>
      <SEOHead
        title="Fachinformatiker AE Prüfungsvorbereitung – AP2"
        description="IHK-Abschlussprüfung Teil 2 (FIAE) komplett: GA1 Anwendungsentwicklung, GA2 WiSo, betriebliches Projekt & Fachgespräch. Selbsttest, Lernplan, KI-Coach."
        canonical={`${SITE_URL}/fachinformatiker-ae-pruefungsvorbereitung`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Fachinformatiker AE' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">FIAE · IHK AP2</Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Fachinformatiker AE</span> Prüfungsvorbereitung – AP2 sicher bestehen
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                GA1 Anwendungsentwicklung, GA2 WiSo und das betriebliche Projekt mit Fachgespräch – strukturiert
                vorbereitet mit Probeklausuren, Lernplan und KI-Coach.
              </p>
              <div className="flex flex-wrap gap-4">
                <QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="hero" label="Bin ich prüfungsreif? Gratis-Selbsttest" />
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/paket/fachinformatiker-anwendungsentwicklung">Komplettpaket ansehen</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-4">
              Aufbau der <span className="text-gradient">FIAE-Abschlussprüfung Teil 2</span>
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              Drei Prüfungselemente – jedes mit eigenem Trainings-Cluster.
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

        <section className="py-10"><div className="container max-w-4xl"><QuizCTA quizSlug={QUIZ} cluster={CLUSTER} location="mid" /></div></section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">Wesentliche <span className="text-gradient">Handlungsfelder</span></h2>
            <div className="space-y-4">
              {HANDLUNGSFELDER.map(hf => (
                <Card key={hf.nr} className="border-border/50">
                  <CardContent className="py-4 flex gap-4 items-start">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">{hf.nr}</div>
                    <div>
                      <h3 className="font-semibold">{hf.title}</h3>
                      <p className="text-sm text-muted-foreground">{hf.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl">
            <h2 className="text-2xl font-display font-bold mb-6 text-center">Typische Prüfungsfehler – und wie du sie vermeidest</h2>
            <div className="space-y-3">
              {TYPISCHE_FEHLER.map(f => (
                <Card key={f.title} className="border-border/50"><CardContent className="py-4">
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent></Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">FIAE-Prüfung auf einen Blick</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: Clock, label: 'GA1 Anwendungsentwicklung', value: 'Ungebundene Aufgaben (OOP, SQL, Schnittstellen)' },
                { icon: Clock, label: 'GA2 WiSo', value: 'Mischung aus gebundenen und offenen Aufgaben' },
                { icon: Briefcase, label: 'Projekt + Fachgespräch', value: 'Betriebliches Projekt mit Doku, Präsentation und Fachgespräch' },
                { icon: Target, label: 'Bestehen', value: 'Jeder Prüfungsteil mindestens „ausreichend"' },
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

        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-xl font-semibold mb-4">Direkt weiterlernen</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Link to={`/quiz/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>5-Fragen-Selbsttest</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to={`/lernplan/${QUIZ}`} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Persönlicher Lernplan</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/paket/fachinformatiker-anwendungsentwicklung" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Komplettpaket</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
              <Link to="/pruefungstraining/fachinformatiker-ae" className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 flex items-center justify-between"><span>Mündliche Prüfungssimulation</span><ArrowRight className="h-4 w-4 text-primary" /></Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur FIAE-Prüfung</h2>
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
          label="Bereit für die FIAE-Abschlussprüfung?"
          subtitle={`Starte mit dem 5-Fragen-Selbsttest, erhalte deinen Lernplan und entscheide danach, ob du das Komplettpaket (${PRICING.defaultPrice}) brauchst.`} />
      </div>
    </>
  );
}
