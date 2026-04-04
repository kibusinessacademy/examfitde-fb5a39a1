import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, GraduationCap, Award, Shield, Briefcase, Target,
  ChevronDown, CheckCircle2, TrendingUp, Brain, Zap,
} from 'lucide-react';

const CAREER_LEVELS = [
  {
    level: 1,
    key: 'ausbildung',
    title: 'Ausbildung',
    subtitle: 'IHK-Abschlussprüfung',
    description: 'Starte mit dem Fundament: Bestehe deine IHK-Abschlussprüfung sicher mit realistischer Simulation und KI-Prüfungscoach.',
    icon: GraduationCap,
    price: `ab ${PRICING.defaultPrice}`,
    dqr: 'DQR 3–4',
    examples: ['Industriekaufmann/-frau', 'Fachinformatiker/in', 'Kaufleute für Büromanagement'],
    href: '/pruefungstraining/ausbildung',
    color: 'bg-primary/10 text-primary',
  },
  {
    level: 2,
    key: 'fachwirt',
    title: 'Fachwirt',
    subtitle: 'IHK-Fortbildungsprüfung',
    description: 'Der nächste Karriereschritt: Fachwirt-Prüfungen mit anspruchsvollen Fallstudien, Analyse-Aufgaben und mündlicher Simulation.',
    icon: Award,
    price: 'ab 149 €',
    dqr: 'DQR 6',
    examples: ['Wirtschaftsfachwirt/in', 'Handelsfachwirt/in', 'Industriefachwirt/in'],
    href: '/pruefungstraining/fachwirt',
    color: 'bg-accent/10 text-accent',
  },
  {
    level: 3,
    key: 'meister',
    title: 'Meister',
    subtitle: 'IHK-/HWK-Meisterprüfung',
    description: 'Meister-Level: Komplexe situative Aufgaben, Präsentationstraining und strategische Bewertung für die Meisterprüfung.',
    icon: Shield,
    price: 'ab 199 €',
    dqr: 'DQR 6',
    examples: ['Industriemeister Metall', 'Industriemeister Elektrotechnik', 'Handwerksmeister'],
    href: '/pruefungstraining/meister',
    color: 'bg-success/10 text-success',
  },
  {
    level: 4,
    key: 'betriebswirt',
    title: 'Betriebswirt',
    subtitle: 'Höhere IHK-Fortbildung',
    description: 'Die Spitze: Strategische Prüfungsvorbereitung mit Evaluations- und Entscheidungsaufgaben auf höchstem Niveau.',
    icon: Briefcase,
    price: 'ab 249 €',
    dqr: 'DQR 7',
    examples: ['Geprüfter Betriebswirt (IHK)', 'Technischer Betriebswirt'],
    href: '/pruefungstraining/betriebswirt',
    color: 'bg-warning/10 text-warning',
  },
];

const FAQS = [
  {
    question: 'Kann ich ExamFit für mehrere Karrierestufen nutzen?',
    answer: 'Ja! ExamFit begleitet dich von der Ausbildung bis zum Betriebswirt. Jede Stufe hat ein eigenes Prüfungstraining mit angepasstem Schwierigkeitsgrad und Fragentypen.',
  },
  {
    question: 'Wie unterscheidet sich das Training pro Karrierelevel?',
    answer: 'Der Schwierigkeitsgrad und die Aufgabentypen passen sich dem Level an. Ausbildung fokussiert auf Anwendungswissen, Fachwirte auf Analyse, Meister auf Evaluation und Betriebswirte auf strategische Entscheidungen.',
  },
  {
    question: 'Gibt es Karriere-Bundles mit Rabatt?',
    answer: 'Ja, wir bieten Karriere-Bundles an, mit denen du mehrere Stufen zu einem vergünstigten Gesamtpreis trainieren kannst.',
  },
  {
    question: 'Bezahlt mein Arbeitgeber das Prüfungstraining?',
    answer: 'Viele Arbeitgeber übernehmen die Kosten für Fortbildungsprüfungen. ExamFit bietet Unternehmenslizenzen mit Mengenrabatten und Rechnung.',
  },
];

export default function KarrierePage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Karriere-Roadmap' },
  ];

  return (
    <>
      <SEOHead
        title="Karriere-Roadmap – Vom Azubi zum Betriebswirt | ExamFit"
        description="Dein Karrierepfad mit ExamFit: Prüfungstraining für Ausbildung, Fachwirt, Meister & Betriebswirt. Adaptive Schwierigkeit, IRT-Psychometrie & KI-Coach für jede Stufe."
        canonical={`${SITE_URL}/karriere`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-16 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/8" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Karriere-Roadmap' }]} />
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Vom Azubi zum Betriebswirt –{' '}
              <span className="text-gradient">eine Plattform, alle Prüfungen</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              ExamFit begleitet dich über deine gesamte Karriere. Jede Stufe mit angepasstem
              Schwierigkeitsgrad, realistischer Simulation und KI-Prüfungscoach.
            </p>
          </div>
        </section>

        {/* Career Ladder */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-accent to-warning hidden md:block" />

              <div className="space-y-8">
                {CAREER_LEVELS.map((level, idx) => {
                  const Icon = level.icon;
                  return (
                    <div key={level.key} className="relative">
                      {/* Connector dot */}
                      <div className="absolute left-6 top-8 w-4 h-4 rounded-full border-2 border-primary bg-background z-10 hidden md:block" />

                      <div className="md:ml-20">
                        <Card className="group hover:border-primary/40 transition-all duration-300 hover:shadow-lg">
                          <CardContent className="p-6 md:p-8">
                            <div className="flex flex-col md:flex-row md:items-start gap-6">
                              {/* Icon + Level */}
                              <div className="flex items-center gap-4 md:flex-col md:items-center md:min-w-[80px]">
                                <div className={`p-3 rounded-xl ${level.color}`}>
                                  <Icon className="h-7 w-7" />
                                </div>
                                <Badge variant="outline" className="text-xs">
                                  Level {level.level}
                                </Badge>
                              </div>

                              {/* Content */}
                              <div className="flex-1 space-y-3">
                                <div>
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <h2 className="text-2xl font-display font-bold group-hover:text-primary transition-colors">
                                      {level.title}
                                    </h2>
                                    <Badge variant="secondary" className="text-xs">
                                      {level.dqr}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{level.subtitle}</p>
                                </div>
                                <p className="text-muted-foreground">{level.description}</p>
                                <div className="flex flex-wrap gap-2">
                                  {level.examples.map(ex => (
                                    <span key={ex} className="text-xs bg-muted px-2.5 py-1 rounded-full">
                                      {ex}
                                    </span>
                                  ))}
                                </div>
                                <div className="flex items-center justify-between pt-2">
                                  <span className="text-lg font-bold text-gradient">{level.price}</span>
                                  <Button variant="outline" size="sm" asChild className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                    <Link to={level.href}>
                                      Prüfungen ansehen <ArrowRight className="ml-1 h-4 w-4" />
                                    </Link>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Arrow between levels */}
                      {idx < CAREER_LEVELS.length - 1 && (
                        <div className="flex justify-center py-2 md:ml-20">
                          <ChevronDown className="h-6 w-6 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Why Career Platform */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Warum ExamFit für <span className="text-gradient">jede Karrierestufe</span>?
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: Brain,
                  title: 'Adaptive Schwierigkeit',
                  desc: 'Bloom-Taxonomie passt sich automatisch an: Ausbildung = Anwenden, Fachwirt = Analysieren, Meister = Bewerten.',
                },
                {
                  icon: TrendingUp,
                  title: 'Karriere-LTV',
                  desc: 'Ein Account, alle Prüfungen. Dein Fortschritt und deine Stärken wachsen mit dir über Jahre hinweg.',
                },
                {
                  icon: Zap,
                  title: 'Mündliche Simulation',
                  desc: 'Je höher das Level, desto realistischer: Fachgespräche, Präsentationen, strategische Argumentation.',
                },
              ].map(usp => (
                <Card key={usp.title} className="border-border/50">
                  <CardContent className="pt-6 text-center space-y-3">
                    <usp.icon className="h-10 w-10 mx-auto text-primary" />
                    <h3 className="font-semibold text-lg">{usp.title}</h3>
                    <p className="text-sm text-muted-foreground">{usp.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* B2B Hint */}
        <section className="py-12">
          <div className="container max-w-3xl">
            <Card className="glass-card ring-1 ring-primary/20">
              <CardContent className="p-8 text-center space-y-4">
                <Badge variant="outline">Für Ausbildungsbetriebe</Badge>
                <h3 className="text-xl font-bold">
                  Karriere-Bundles für Ihre Mitarbeiter
                </h3>
                <p className="text-muted-foreground">
                  Vom Azubi zum Fachwirt – begleiten Sie Ihre Mitarbeiter mit einem
                  durchgängigen Prüfungstrainings-System. Mengenrabatte ab 5 Lizenzen.
                </p>
                <Button asChild>
                  <Link to="/betriebe">
                    Business-Lizenzen ansehen <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur Karriere-Roadmap</h2>
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
        <section className="py-20">
          <div className="container text-center space-y-6">
            <h2 className="text-3xl md:text-4xl font-display font-bold">
              Bereit für den nächsten Karriereschritt?
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Wähle dein Level und starte mit dem Prüfungstraining.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/pruefungstraining">
                  <Target className="mr-2 h-5 w-5" /> Alle Prüfungen ansehen
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
