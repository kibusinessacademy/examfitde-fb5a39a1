import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Calendar, BarChart3, Brain, BookOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SEOInternalLinks } from '@/components/seo/SEOInternalLinks';
import { generateBreadcrumbSchema, generateFAQSchema, generateOrganizationSchema, SITE_URL } from '@/lib/seo';

const FAQS = [
  { question: 'Wie erstelle ich einen Lernplan für die Prüfung?', answer: 'Teile den Stoff in Lerneinheiten auf, setze feste Lernzeiten und plane regelmäßige Wiederholungen ein. ExamFit strukturiert das automatisch nach Lernfeldern.' },
  { question: 'Wie viel Zeit sollte ich für die Prüfungsvorbereitung einplanen?', answer: 'Das hängt von der Prüfung ab. Als Richtwert: 4–8 Wochen bei 1–2 Stunden täglich. ExamFit zeigt dir deine Fortschritte und empfiehlt Trainingsintensität.' },
  { question: 'Was hilft gegen Prüfungsangst?', answer: 'Regelmäßiges Üben, realistische Probeprüfungen und eine gute Zeitplanung reduzieren Prüfungsangst am wirksamsten. ExamFit gibt dir eine Bestehenswahrscheinlichkeit als Orientierung.' },
  { question: 'Wie wiederhole ich den Stoff am effektivsten?', answer: 'Nutze Spaced Repetition: Wiederhole Themen in zunehmenden Abständen. ExamFit erkennt automatisch Schwachstellen und wiederholt diese gezielt.' },
  { question: 'Kann ich den Lernplan auch auf dem Handy nutzen?', answer: 'Ja, ExamFit ist vollständig mobil nutzbar. Du kannst überall trainieren – auch offline nach dem ersten Laden.' },
];

const METHODEN = [
  { icon: Calendar, title: 'Zeitplanung', desc: 'Teile den Stoff in Wochen und Tage ein. Setze feste Lernzeiten und halte dich daran.' },
  { icon: RefreshCw, title: 'Spaced Repetition', desc: 'Wiederhole Themen in zunehmenden Abständen – das Gehirn speichert so dauerhafter.' },
  { icon: BarChart3, title: 'Fortschritt messen', desc: 'Verfolge deine Bestehenswahrscheinlichkeit und erkenne Schwachstellen früh.' },
  { icon: Brain, title: 'Aktives Lernen', desc: 'Übe mit Fragen statt nur zu lesen. Aktives Abrufen verankert Wissen tiefer.' },
];

export default function LernplanPruefungPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Prüfungstraining', url: `${SITE_URL}/pruefungstraining` },
    { name: 'Lernplan' },
  ];

  const structuredData = [
    generateBreadcrumbSchema(breadcrumbs),
    generateFAQSchema(FAQS),
    generateOrganizationSchema(),
  ];

  return (
    <>
      <SEOHead
        title="Lernplan für Prüfungen erstellen – effektiv lernen & bestehen | ExamFit"
        description="Lernplan für deine Prüfung erstellen: Zeitplanung, Spaced Repetition und Schwächenanalyse. Effektiv lernen für IHK, Sachkunde & Fachwirt."
        canonical={`${SITE_URL}/lernplan-pruefung`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative py-16 md:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10">
            <Breadcrumbs items={[
              { label: 'Prüfungstraining', href: '/pruefungstraining' },
              { label: 'Lernplan' },
            ]} className="mb-8" />
            <div className="max-w-4xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                Lernplan &amp; Lernmethoden
              </Badge>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6">
                <span className="text-gradient">Lernplan</span> für deine Prüfung
                <br />
                <span className="text-2xl md:text-3xl text-muted-foreground font-normal">Effektiv lernen mit System</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
                Lerne nicht mehr, sondern klüger. Mit einem strukturierten Lernplan, 
                adaptiver Wiederholung und messbarem Fortschritt.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                  <Link to="/shop">Lernplan starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                  <Link to="/pruefungsfragen">Direkt Prüfungsfragen üben</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Methoden */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Die besten <span className="text-gradient">Lernmethoden</span> für deine Prüfung
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {METHODEN.map(m => (
                <Card key={m.title} className="glass-card">
                  <CardHeader>
                    <m.icon className="h-10 w-10 text-primary mb-4" />
                    <CardTitle>{m.title}</CardTitle>
                    <CardDescription>{m.desc}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Schritt-für-Schritt */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold mb-8">
              In 5 Schritten zum <span className="text-gradient">Prüfungserfolg</span>
            </h2>
            <div className="space-y-6">
              {[
                { step: '1', title: 'Stoffumfang erfassen', desc: 'Verschaffe dir einen Überblick über alle Lernfelder und Themengebiete deiner Prüfung.' },
                { step: '2', title: 'Zeitbudget festlegen', desc: 'Wie viele Wochen hast du? Wie viele Stunden pro Tag sind realistisch?' },
                { step: '3', title: 'Schwerpunkte setzen', desc: 'Konzentriere dich auf prüfungsrelevante Themen. ExamFit zeigt dir, was am häufigsten gefragt wird.' },
                { step: '4', title: 'Regelmäßig üben', desc: 'Trainiere täglich mit Prüfungsfragen. Kurze, regelmäßige Sessions sind besser als Marathon-Lernen.' },
                { step: '5', title: 'Probeprüfung machen', desc: 'Teste dich unter echten Bedingungen. Deine Bestehenswahrscheinlichkeit zeigt dir, wo du stehst.' },
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

        {/* Cluster-Links */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-4xl">
            <SEOInternalLinks 
              sourceUrl="/lernplan-pruefung" 
              linkTypes={['cluster_to_pillar', 'cluster_to_cluster']}
              title="Weitere Prüfungsvorbereitung"
            />
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen zum Lernplan</h2>
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
              Lerne klüger – nicht mehr
            </h2>
            <p className="text-xl text-muted-foreground">
              Starte jetzt mit einem strukturierten Lernplan und steigere deine Bestehenschancen.
            </p>
            <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
              <Link to="/shop">Jetzt Lernplan starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
