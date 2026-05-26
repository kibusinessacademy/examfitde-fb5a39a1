import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, generateCourseSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Award, BookOpen, Brain, Calculator, CheckCircle2,
  Clock, FileText, MessageSquare, Target, TrendingUp, Users, Zap,
} from 'lucide-react';
import { QuizCTA } from '@/components/quiz/QuizCTA';


/* ── Exam Structure from WFachwPrV ── */
const TEIL_1 = [
  { key: 'vwl', name: 'Volks- und Betriebswirtschaft', dauer: 60, topics: ['Volkswirtschaftliche Grundlagen', 'Betriebliche Funktionen', 'Existenzgründung & Rechtsformen', 'Unternehmenszusammenschlüsse'] },
  { key: 'rewe', name: 'Rechnungswesen', dauer: 90, topics: ['Grundlagen Rechnungswesen', 'Finanzbuchhaltung', 'Kosten- und Leistungsrechnung', 'BWA-Auswertung', 'Planungsrechnung'] },
  { key: 'recht', name: 'Recht und Steuern', dauer: 60, topics: ['Bürgerliches & Handelsrecht', 'Arbeitsrecht', 'Vertragsgestaltung', 'Steuerrecht'] },
  { key: 'uf', name: 'Unternehmensführung', dauer: 90, topics: ['Betriebsorganisation', 'Personalführung', 'Personalentwicklung'] },
];

const TEIL_2 = [
  { key: 'mgmt', name: 'Betriebliches Management', topics: ['Planungsprozesse & Statistik', 'Organisations- & Personalentwicklung', 'IT & Wissensmanagement', 'Managementtechniken'] },
  { key: 'fin', name: 'Investition, Finanzierung & Controlling', topics: ['Investitionsrechnung', 'Finanzplanung', 'Finanzierungsarten', 'KLR', 'Controlling-Instrumente'] },
  { key: 'log', name: 'Logistik', topics: ['Beschaffung/Einkauf', 'Materialwirtschaft', 'Fertigungsabläufe', 'Rationalisierung'] },
  { key: 'mkt', name: 'Marketing und Vertrieb', topics: ['Marketingplanung', 'Marketing-Mix', 'Vertriebsmanagement', 'Internationale Geschäftsbeziehungen'] },
  { key: 'fzs', name: 'Führung und Zusammenarbeit', topics: ['Kommunikation & Kooperation', 'Mitarbeitergespräche', 'Konfliktmanagement', 'Mitarbeiterförderung', 'Moderation & Präsentation'] },
];

const FAQS = [
  { question: 'Was kostet das Wirtschaftsfachwirt-Prüfungstraining bei ExamFit?', answer: `Einmalig ${PRICING.defaultPrice} für ${PRICING.defaultAccess} Vollzugriff — alle 9 Qualifikationsbereiche, über 1.200 Aufgaben, mündliche Simulation und KI-Prüfungscoach. Kein Abo, keine versteckten Kosten.` },
  { question: 'Wie realistisch ist die Prüfungssimulation?', answer: 'Unsere Simulation bildet beide Teilprüfungen exakt ab – inklusive Zeitbegrenzung (330 Min. schriftlich), gewichteter Bewertung und Ergänzungsprüfungs-Logik. Das mündliche Fachgespräch wird mit 30 Min. Vorbereitung + Präsentation simuliert.' },
  { question: 'Deckt ExamFit alle 9 Qualifikationsbereiche ab?', answer: 'Ja, alle 4 wirtschaftsbezogenen und 5 handlungsspezifischen Bereiche werden vollständig abgedeckt – mit Fallstudien, Rechenaufgaben und situativen Szenarien.' },
  { question: 'Gibt es eine mündliche Prüfungssimulation?', answer: 'Ja! Unser Oral-Exam-Trainer simuliert das situationsbezogene Fachgespräch mit Präsentation. Du erhältst Feedback zu Fachlichkeit, Struktur, Praxisbezug und Argumentationslogik.' },
  { question: 'Kann ich ExamFit parallel zum Lehrgang nutzen?', answer: 'Absolut. Die meisten Teilnehmer nutzen ExamFit ergänzend zu ihrem IHK-Lehrgang. Der adaptive Algorithmus identifiziert deine Schwächen und erstellt einen individuellen Trainingsplan.' },
  { question: 'Was unterscheidet ExamFit von anderen Anbietern?', answer: 'Psychometrische Prüfungsreife-Prognose (IRT), adaptive Schwächenanalyse, mündliche KI-Simulation und über 1.200 Aufgaben auf Analyse- und Bewertungsniveau – statt nur Multiple-Choice-Grundlagen.' },
];

const USP_CARDS = [
  { icon: Calculator, title: '1.200+ Prüfungsaufgaben', desc: 'Fallstudien, Rechenaufgaben und situative Szenarien – exakt auf WFachwPrV-Niveau.' },
  { icon: MessageSquare, title: 'Mündliche Simulation', desc: '30 Min. Fachgespräch mit Präsentation – inkl. Bewertung nach IHK-Kriterien.' },
  { icon: Brain, title: 'Adaptive Psychometrie', desc: 'IRT-basierte Bestehenswahrscheinlichkeit. Dein Coach weiß, wo du stehst.' },
  { icon: TrendingUp, title: 'Schwächen-Engine', desc: 'Automatische Nachschulung in schwachen Bereichen nach jeder Simulation.' },
  { icon: Clock, title: 'Realistische Zeitbegrenzung', desc: '330 Min. schriftlich, 30+30 Min. mündlich – exakt wie in der echten Prüfung.' },
  { icon: Zap, title: 'KI-Prüfungscoach', desc: 'Individuelle Erklärungen, Lösungswege und Lernstrategien auf Fachwirt-Niveau.' },
];

export default function WirtschaftsfachwirtPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Karriere', url: `${SITE_URL}/karriere` },
    { name: 'Fachwirt', url: `${SITE_URL}/pruefungstraining/fachwirt` },
    { name: 'Wirtschaftsfachwirt' },
  ];

  const courseSchema = generateCourseSchema({
    id: `${SITE_URL}/pruefungstraining/fachwirt/wirtschaftsfachwirt`,
    name: 'Wirtschaftsfachwirt IHK – Prüfungstraining',
    description: 'Adaptives Prüfungstraining für den Geprüften Wirtschaftsfachwirt (IHK) mit über 1.200 Aufgaben, mündlicher Simulation und KI-Coach.',
    provider: 'ExamFit',
    url: `${SITE_URL}/pruefungstraining/fachwirt/wirtschaftsfachwirt`,
  });

  return (
    <>
      <SEOHead
        title="Wirtschaftsfachwirt Prüfungstraining – 1.200+ Aufgaben & Simulation | ExamFit"
        description={`Bestehe die Wirtschaftsfachwirt IHK-Prüfung sicher: Adaptive Simulation aller 9 Bereiche, mündliches Fachgespräch mit KI, Bestehenswahrscheinlichkeit in Echtzeit. Einmalig ${PRICING.defaultPrice} für ${PRICING.defaultAccess}.`}
        canonical={`${SITE_URL}/pruefungstraining/fachwirt/wirtschaftsfachwirt`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS), courseSchema]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 md:py-20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/8 via-transparent to-primary/8" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[
              { label: 'Start', href: '/' },
              { label: 'Karriere', href: '/karriere' },
              { label: 'Fachwirt', href: '/pruefungstraining/fachwirt' },
              { label: 'Wirtschaftsfachwirt' },
            ]} />
            <div className="flex justify-center gap-2">
              <Badge variant="outline"><Award className="h-3.5 w-3.5 mr-1" /> DQR 6</Badge>
              <Badge variant="outline">IHK-Fortbildung</Badge>
            </div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Wirtschaftsfachwirt <span className="text-gradient">Prüfungstraining</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Über 1.200 prüfungsrelevante Aufgaben. Adaptive Simulation aller 9 Qualifikationsbereiche. 
              Mündliches Fachgespräch mit KI. Bestehenswahrscheinlichkeit in Echtzeit.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/shop">
                  Prüfungstraining starten <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="#pruefungsstruktur">Prüfungsaufbau ansehen</Link>
              </Button>
            </div>
            <div className="flex justify-center pt-2">
              <QuizCTA quizSlug="wirtschaftsfachwirt-pruefungsreife" cluster="wfw_cluster" location="hero" variant="outline" label="Gratis: 5-Fragen-Selbsttest starten" />
            </div>
            <p className="text-sm text-muted-foreground">{PRICING.defaultPrice} · {PRICING.defaultAccess} Zugriff · {PRICING.noSubscription}</p>
          </div>
        </section>

        {/* USP Grid */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Warum ExamFit für den <span className="text-gradient">Wirtschaftsfachwirt</span>?
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {USP_CARDS.map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="border-border/50 hover:border-primary/30 transition-colors">
                  <CardContent className="pt-6 space-y-3">
                    <Icon className="h-9 w-9 text-primary" />
                    <h3 className="font-semibold text-lg">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Quiz Mid-CTA */}
        <section className="py-8">
          <div className="container max-w-4xl">
            <QuizCTA quizSlug="wirtschaftsfachwirt-pruefungsreife" cluster="wfw_cluster" location="mid"
              label="Bist du schon Wirtschaftsfachwirt-prüfungsreif?"
              subtitle="2-Minuten-Selbsttest · sofortiges Ergebnis · persönlicher 6-Wochen-Lernplan." />
          </div>
        </section>

        {/* Exam Structure */}
        <section id="pruefungsstruktur" className="py-16">
          <div className="container max-w-5xl space-y-10">
            <div className="text-center">
              <h2 className="text-3xl font-display font-bold mb-3">
                Prüfungsstruktur <span className="text-gradient">Wirtschaftsfachwirt</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Gemäß WFachwPrV vom 26.08.2008 – alle 9 Qualifikationsbereiche vollständig abgedeckt.
              </p>
            </div>

            {/* Teil 1 */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Badge className="bg-primary/15 text-primary border-primary/30">Teilprüfung 1</Badge>
                <h3 className="text-xl font-bold">Wirtschaftsbezogene Qualifikationen</h3>
                <span className="text-sm text-muted-foreground ml-auto">Schriftlich · max. 330 Min.</span>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {TEIL_1.map(bereich => (
                  <Card key={bereich.key} className="border-border/50">
                    <CardContent className="pt-5 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">{bereich.name}</h4>
                        <Badge variant="outline" className="text-xs">{bereich.dauer} Min.</Badge>
                      </div>
                      <ul className="space-y-1">
                        {bereich.topics.map(t => (
                          <li key={t} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0 mt-0.5" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Teil 2 */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Badge className="bg-accent/15 text-accent border-accent/30">Teilprüfung 2</Badge>
                <h3 className="text-xl font-bold">Handlungsspezifische Qualifikationen</h3>
                <span className="text-sm text-muted-foreground ml-auto">Schriftlich + Mündlich</span>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {TEIL_2.map(bereich => (
                  <Card key={bereich.key} className="border-border/50">
                    <CardContent className="pt-5 space-y-2">
                      <h4 className="font-semibold text-sm">{bereich.name}</h4>
                      <ul className="space-y-1">
                        {bereich.topics.map(t => (
                          <li key={t} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0 mt-0.5" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Mündliche Prüfung */}
            <Card className="glass-card ring-1 ring-accent/20">
              <CardContent className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="p-3 rounded-xl bg-accent/10">
                    <MessageSquare className="h-8 w-8 text-accent" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <h3 className="text-xl font-bold">Situationsbezogenes Fachgespräch mit Präsentation</h3>
                    <p className="text-muted-foreground">
                      30 Minuten Vorbereitungszeit · 30 Minuten Prüfung · Schwerpunkt: Führung und Zusammenarbeit.
                      Die Präsentation geht mit ⅓ in die mündliche Bewertung ein.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Badge variant="outline" className="text-xs">Fallbeschreibung</Badge>
                      <Badge variant="outline" className="text-xs">Strukturierte Präsentation</Badge>
                      <Badge variant="outline" className="text-xs">Fachgespräch</Badge>
                      <Badge variant="outline" className="text-xs">IHK-Bewertungskriterien</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Pricing — Single SSOT-Bundle (24,90 € / 12 Monate) */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-2xl">
            <Card className="ring-2 ring-primary shadow-lg">
              <CardContent className="pt-8 pb-8 space-y-5 text-center">
                <Badge className="bg-primary">Komplettpaket Wirtschaftsfachwirt</Badge>
                <div>
                  <p className="text-4xl font-bold text-gradient">{PRICING.defaultPrice}</p>
                  <p className="text-sm text-muted-foreground mt-1">einmalig · {PRICING.defaultAccess} Vollzugriff · {PRICING.noSubscription}</p>
                </div>
                <ul className="space-y-2 text-sm text-left max-w-md mx-auto">
                  {['Alle 9 Qualifikationsbereiche', '1.200+ Prüfungsaufgaben', 'Mündliche Simulation & Fachgespräch', 'Adaptive Schwächen-Engine', 'KI-Prüfungscoach', 'Bestehens-Prognose (IRT)'].map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="w-full gradient-primary text-primary-foreground" asChild>
                  <Link to="/shop">Jetzt starten <ArrowRight className="ml-1 h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
            <div className="text-center mt-6">
              <p className="text-sm text-muted-foreground">
                Arbeitgeber zahlt? <Link to="/betriebe" className="text-primary hover:underline">Business-Lizenzen ab {PRICING.b2b.tiers[1].unitPriceDisplay}/Seat</Link>
              </p>
            </div>
          </div>
        </section>


        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Wirtschaftsfachwirt-Training</h2>
            <div className="space-y-4">
              {FAQS.map(faq => (
                <details key={faq.question} className="group border border-border rounded-lg">
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">
                    {faq.question}
                  </summary>
                  <p className="px-6 pb-4 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-muted/30">
          <div className="container max-w-3xl">
            <div className="glass-strong rounded-3xl p-10 md:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10 space-y-6">
                <Award className="h-14 w-14 text-primary mx-auto" />
                <h2 className="text-3xl font-display font-bold">
                  Bereit für den Wirtschaftsfachwirt?
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Starte jetzt mit dem adaptiven Prüfungstraining und erhalte deine erste
                  Bestehenswahrscheinlichkeits-Prognose nach nur 30 Minuten.
                </p>
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                  <Link to="/shop">
                    <Target className="mr-2 h-5 w-5" /> Prüfungstraining starten
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer Quiz CTA */}
        <QuizCTA quizSlug="wirtschaftsfachwirt-pruefungsreife" cluster="wfw_cluster" location="footer"
          label="Noch unsicher, ob du startklar bist?"
          subtitle="Mache den 5-Fragen-Selbsttest und erhalte deinen 6-Wochen-Lernplan – kostenlos und ohne Registrierung." />
      </div>
    </>
  );
}
