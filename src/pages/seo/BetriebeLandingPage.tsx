import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Users, BarChart3, ShieldCheck, AlertTriangle,
  CheckCircle2, TrendingUp, Building2, Target, FileText,
  Download, Brain, Zap,
} from 'lucide-react';

const SEAT_PACKAGES = [
  {
    name: 'Starter',
    seats: 10,
    pricePerSeat: 19,
    total: 190,
    features: ['10 Lernlizenzen', 'Prüfungsreife-Ampel', 'Admin-Dashboard', '12 Monate Laufzeit'],
    highlight: false,
  },
  {
    name: 'Business',
    seats: 25,
    pricePerSeat: 16,
    total: 400,
    savings: 222,
    features: ['25 Lernlizenzen', 'Erweiterte Analytics', 'Risiko-Frühwarnsystem', 'Gruppenauswertung', 'CSV-Export'],
    highlight: true,
  },
  {
    name: 'Enterprise',
    seats: 50,
    pricePerSeat: 12,
    total: 600,
    savings: 645,
    features: ['50+ Lernlizenzen', 'Individuelle Reports', 'API-Zugang', 'Jahreslizenz', 'Prioritäts-Support'],
    highlight: false,
  },
];

const FAQS = [
  {
    question: 'Ab wie vielen Azubis lohnt sich ExamFit Business?',
    answer: 'Bereits ab 5 Auszubildenden erhalten Sie automatisch Mengenrabatte. Die meisten Betriebe starten mit 10–25 Lizenzen.',
  },
  {
    question: 'Kann ich die Prüfungsreife meiner Azubis einsehen?',
    answer: 'Ja, das Admin-Dashboard zeigt Ihnen für jeden Auszubildenden die aktuelle Bestehenswahrscheinlichkeit, Stärken-/Schwächenprofil und den Trainingsfortschritt.',
  },
  {
    question: 'Funktioniert ExamFit für verschiedene Ausbildungsberufe gleichzeitig?',
    answer: 'Ja, jede Lizenz kann für einen beliebigen Ausbildungsberuf aktiviert werden. Sie können verschiedene Berufe innerhalb eines Pakets mischen.',
  },
  {
    question: 'Erhalte ich eine ordentliche Rechnung?',
    answer: 'Ja, Sie erhalten automatisch eine Rechnung mit ausgewiesener MwSt. für Ihre Buchhaltung.',
  },
  {
    question: 'Gibt es eine Testphase?',
    answer: 'Wir bieten eine 14-tägige Testphase für bis zu 3 Auszubildende an. Kontaktieren Sie uns für einen Testzugang.',
  },
];

export default function BetriebeLandingPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Für Betriebe' },
  ];

  return (
    <>
      <SEOHead
        title="ExamFit Business – Prüfungstraining für Ausbildungsbetriebe"
        description="Bestehensquoten erhöhen, Durchfallrisiken erkennen: ExamFit Business bietet Seat-Pakete, Prüfungsreife-Dashboard und Frühwarnsystem für Ihre Auszubildenden. Ab 19€/Seat."
        canonical={`${SITE_URL}/betriebe`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* Hero */}
        <section className="py-20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-success/8" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Für Betriebe' }]} />
            <Badge variant="outline" className="text-sm px-4 py-1">
              <Building2 className="h-3.5 w-3.5 mr-1.5" /> Für Ausbildungsbetriebe
            </Badge>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Bestehensquoten erhöhen.{' '}
              <span className="text-gradient">Ausbildungsqualität messen.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              ExamFit Business gibt Ihnen die Werkzeuge, um Ihre Auszubildenden
              datenbasiert und gezielt auf die IHK-Prüfung vorzubereiten.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                <Link to="/shop">
                  Business-Lizenzen erwerben <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="#pakete">
                  Pakete vergleichen
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Key Arguments */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Warum führende Betriebe auf ExamFit <span className="text-gradient">setzen</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: BarChart3, title: 'Prüfungsreife messen', desc: 'Bestehenswahrscheinlichkeit pro Azubi – objektiv und in Echtzeit.' },
                { icon: AlertTriangle, title: 'Frühwarnsystem', desc: '3 Monate vor der Prüfung wissen, wer durchfällt.' },
                { icon: TrendingUp, title: 'Durchfallquoten senken', desc: 'Weniger Wiederholungen = weniger Kosten + schnellerer Einsatz.' },
                { icon: ShieldCheck, title: 'Qualität standardisieren', desc: 'Einheitliches Training für alle Standorte und Berufe.' },
              ].map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="border-border/50 text-center">
                  <CardContent className="pt-6 space-y-3">
                    <Icon className="h-10 w-10 mx-auto text-primary" />
                    <h3 className="font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Dashboard Preview */}
        <section className="py-16">
          <div className="container max-w-4xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Das <span className="text-gradient">Business-Dashboard</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Sehen Sie auf einen Blick, wo Ihre Auszubildenden stehen – und wo Handlungsbedarf besteht.
            </p>
            {/* Simulated Dashboard Cards */}
            <div className="grid sm:grid-cols-3 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-gradient mb-1">87%</div>
                  <p className="text-xs text-muted-foreground">Ø Bestehenswahrscheinlichkeit</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-warning mb-1">3</div>
                  <p className="text-xs text-muted-foreground">Azubis mit Risiko (&lt;50%)</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-success mb-1">92%</div>
                  <p className="text-xs text-muted-foreground">Trainingsaktivität (7 Tage)</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Seat Packages */}
        <section id="pakete" className="py-16 bg-muted/30">
          <div className="container max-w-5xl space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-display font-bold mb-2">
                Business-Pakete
              </h2>
              <p className="text-muted-foreground">Einmalig zahlen. 12 Monate trainieren. Kein Abo.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {SEAT_PACKAGES.map(pkg => (
                <Card
                  key={pkg.name}
                  className={`relative ${pkg.highlight ? 'ring-2 ring-primary shadow-lg' : ''}`}
                >
                  {pkg.highlight && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                      Beliebteste Wahl
                    </Badge>
                  )}
                  <CardHeader className="text-center pt-8">
                    <CardTitle className="text-xl font-display">{pkg.name}</CardTitle>
                    <p className="text-muted-foreground text-sm">{pkg.seats} Lizenzen</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center">
                      <span className="text-4xl font-bold text-gradient">{pkg.pricePerSeat} €</span>
                      <span className="text-muted-foreground text-sm"> / Lizenz</span>
                      {pkg.savings && (
                        <p className="text-xs text-success mt-1">
                          Sie sparen {pkg.savings} € gegenüber Einzelkauf
                        </p>
                      )}
                    </div>
                    <ul className="space-y-2">
                      {pkg.features.map(f => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full ${pkg.highlight ? 'gradient-primary text-primary-foreground shadow-glow' : ''}`}
                      variant={pkg.highlight ? 'default' : 'outline'}
                      asChild
                    >
                      <Link to="/shop">
                        {pkg.seats} Lizenzen erwerben <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Mehr als 50 Lizenzen? Individuelle Konditionen werden automatisch berechnet.
            </p>
          </div>
        </section>

        {/* Features for Business */}
        <section className="py-16">
          <div className="container max-w-4xl space-y-8">
            <h2 className="text-3xl font-display font-bold text-center">
              Was Ihr Business-Paket <span className="text-gradient">beinhaltet</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { icon: Brain, title: 'KI-Prüfungscoach', desc: 'Individuelles Feedback und adaptive Schwächenanalyse für jeden Azubi.' },
                { icon: Target, title: 'Prüfungssimulation', desc: 'Realistische IHK-Prüfungen unter Prüfungsbedingungen – schriftlich & mündlich.' },
                { icon: FileText, title: 'Reports & Export', desc: 'Kompetenzstände als CSV exportieren für Ihre Ausbildungsplanung.' },
                { icon: Zap, title: 'Frühwarnsystem', desc: 'Automatische Benachrichtigung bei sinkender Bestehenswahrscheinlichkeit.' },
                { icon: Download, title: 'Ordentliche Rechnung', desc: 'Professionelle Rechnung mit MwSt. für Ihre Buchhaltung.' },
                { icon: Users, title: 'Lizenzverwaltung', desc: 'Lizenzen einfach per Code oder E-Mail an Azubis verteilen.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 glass-card rounded-xl p-5">
                  <Icon className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen für Betriebe</h2>
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
          <div className="container max-w-4xl">
            <div className="glass-strong rounded-3xl p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10 space-y-6">
                <Building2 className="h-14 w-14 text-primary mx-auto" />
                <h2 className="text-3xl font-display font-bold">
                  Prüfungserfolg für Ihre Auszubildenden sichern
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Starten Sie mit 10 Lizenzen und sehen Sie innerhalb von 30 Tagen,
                  wie sich die Prüfungsreife Ihrer Azubis verbessert.
                </p>
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow" asChild>
                  <Link to="/shop">
                    Business-Lizenzen erwerben <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
