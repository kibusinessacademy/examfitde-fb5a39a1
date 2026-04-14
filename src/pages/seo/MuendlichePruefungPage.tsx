import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, MessageSquare, Users, Lightbulb, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, generateOrganizationSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Was erwartet mich bei der mündlichen Prüfung?', answer: 'Die mündliche Prüfung besteht meist aus einem Fachgespräch (15–30 Min.), in dem Prüfer gezielte Fragen zu berufspraktischen Themen stellen. Bei manchen Prüfungen kommt eine Präsentation oder Fallbearbeitung hinzu.' },
  { question: 'Wie bereite ich mich auf das Fachgespräch vor?', answer: 'Trainiere mit typischen Fachgespräch-Fragen, übe das freie Sprechen zu Fachthemen und simuliere die Prüfungssituation. ExamFit hilft mit strukturierten Fragen und KI-gestütztem Feedback.' },
  { question: 'Welche Fragen kommen bei der mündlichen IHK-Prüfung?', answer: 'Typische Fragen betreffen betriebliche Abläufe, Fachbegriffe, Problemlösungsstrategien und die Verknüpfung von Theorie und Praxis. Die Fragen sind berufsspezifisch.' },
  { question: 'Wie kann ich Prüfungsangst bei der mündlichen Prüfung reduzieren?', answer: 'Die beste Strategie ist Übung. Je mehr du die Prüfungssituation simulierst, desto sicherer wirst du. ExamFit bietet Fachgespräch-Fragen zum selbständigen Üben.' },
  { question: 'Zählt die mündliche Prüfung genauso wie die schriftliche?', answer: 'Bei IHK-Prüfungen fließt das Fachgespräch in der Regel mit 30–50% in die Gesamtnote ein. Eine gute mündliche Leistung kann eine schwächere schriftliche ausgleichen.' },
];

const TIPPS = [
  { icon: MessageSquare, title: 'Fachgespräch üben', desc: 'Trainiere mit typischen Prüferfragen aus deinem Berufsfeld – strukturiert und praxisnah.' },
  { icon: Lightbulb, title: 'Antwortstrategien lernen', desc: 'Lerne, wie du Fragen strukturiert und überzeugend beantwortest – auch bei Wissenslücken.' },
  { icon: Shield, title: 'Prüfungsangst reduzieren', desc: 'Durch wiederholte Simulation wirst du sicherer und souveräner in der Prüfungssituation.' },
  { icon: Users, title: 'Präsentation vorbereiten', desc: 'Für Prüfungen mit Präsentationsteil: Struktur, Timing und Kernbotschaften trainieren.' },
];

export default function MuendlichePruefungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Mündliche Prüfung' },
  ];

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema(FAQS),
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title="Mündliche Prüfung vorbereiten – Fachgespräch üben & bestehen | ExamFit"
        description="Mündliche Prüfung sicher bestehen: Fachgespräch-Fragen üben, Antwortstrategien lernen und Prüfungsangst reduzieren. IHK, HWK & Sachkunde."
        canonical={`${SITE_URL}/muendliche-pruefung`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Mündliche Prüfung' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                Mündliche Prüfung &amp; Fachgespräch
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Mündliche Prüfung</span> sicher bestehen
                <br />
                <span className="text-2xl md:text-3xl text-muted-foreground font-normal">Fachgespräch vorbereiten mit System</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Trainiere mit typischen Fachgespräch-Fragen, lerne Antwortstrategien und 
                gehe souverän in deine mündliche Prüfung.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Fachgespräch trainieren <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/pruefungsfragen">Schriftliche Prüfungsfragen üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Tipps */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              So bereitest du dich auf die <span className="text-gradient">mündliche Prüfung</span> vor
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {TIPPS.map(tipp => (
                <Card key={tipp.title} className="glass-card">
                  <CardHeader>
                    <tipp.icon className="h-10 w-10 text-primary mb-4" />
                    <CardTitle>{tipp.title}</CardTitle>
                    <CardDescription>{tipp.desc}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Ablauf */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">
              Typischer Ablauf der <span className="text-gradient">mündlichen Prüfung</span>
            </h2>
            <div className="space-y-6">
              {[
                { step: '1', title: 'Begrüßung & Einleitung', desc: 'Der Prüfungsausschuss stellt sich vor und erklärt den Ablauf. Du hast kurz Zeit, dich zu sammeln.' },
                { step: '2', title: 'Fachgespräch oder Präsentation', desc: 'Je nach Prüfungsordnung: Fachgespräch mit gezielten Fragen oder freie Präsentation eines Themas.' },
                { step: '3', title: 'Vertiefende Fragen', desc: 'Die Prüfer stellen Nachfragen, um dein Verständnis zu vertiefen und Transferwissen zu prüfen.' },
                { step: '4', title: 'Bewertung & Ergebnis', desc: 'Der Prüfungsausschuss berät und teilt dir das Ergebnis mit – meist direkt im Anschluss.' },
              ].map(item => (
                <div key={item.step} className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Produkt-Links */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-display font-bold mb-6">
              Mündliche Prüfung vorbereiten für deine <span className="text-gradient">Prüfung</span>
            </h2>
            <SEOInternalLinks 
              sourceUrl="/muendliche-pruefung" 
              linkTypes={['cluster_to_product']}
              maxLinks={6}
            />
            <div className="mt-6 text-center">
              <Button variant="outline" asChild>
                <Link to="/pruefungstraining">Alle Prüfungstrainer entdecken <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Cluster-Links */}
        <section className="py-12">
          <div className="container max-w-4xl">
            <SEOInternalLinks 
              sourceUrl="/muendliche-pruefung" 
              linkTypes={['cluster_to_pillar', 'cluster_to_cluster']}
              title="Weitere Prüfungsvorbereitung"
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zur mündlichen Prüfung</h2>
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

        {/* Final CTA */}
        <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container text-center max-w-3xl space-y-6">
            <h2 className="text-3xl md:text-4xl font-display font-bold">
              Souverän ins Fachgespräch
            </h2>
            <p className="text-xl text-muted-foreground">
              Trainiere jetzt mit prüfungsnahen Fragen und gehe sicher in deine mündliche Prüfung.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Fachgespräch trainieren <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
