import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING_CATEGORIES } from '@/config/pricing';
import {
  ArrowRight, CheckCircle2, BookOpen, Users, Eye, Shield,
  GraduationCap, BarChart3, Brain, Target, AlertTriangle,
  Shuffle, RefreshCw, UserPlus, Building2,
} from 'lucide-react';

const SEAT_EXAMPLE = [
  { name: 'Klasse 10a', beruf: 'Industriekaufmann/frau', seats: 12 },
  { name: 'Klasse 10b', beruf: 'Büromanagement', seats: 8 },
  { name: 'Klasse 11a', beruf: 'Mechatroniker/in', seats: 10 },
];

const FAQS = [
  { question: 'Ersetzt ExamFit den Berufsschulunterricht?', answer: 'Nein. ExamFit ist ein ergänzendes Prüfungstrainings-System. Es ersetzt weder Unterricht noch Fachliteratur, sondern unterstützt Schülerinnen und Schüler bei der gezielten, selbstständigen Prüfungsvorbereitung.' },
  { question: 'Können Lehrkräfte die Fortschritte einsehen?', answer: 'Ja. Über das Lehrer-Dashboard sehen Lehrkräfte den Kompetenzstand jedes Schülers, Risiko-Einschätzungen und den Trainingsfortschritt – pro Klasse und pro Beruf.' },
  { question: 'Funktioniert ExamFit für verschiedene Berufe gleichzeitig?', answer: 'Ja! Eine Teamlizenz für Ausbildung deckt alle Ausbildungsberufe ab. Ob Automobilkaufmann oder Mechatroniker – alle nutzen dieselbe Lizenz.' },
  { question: 'Wie werden Plätze verteilt?', answer: 'Lehrkräfte oder die Schulverwaltung weisen Plätze per E-Mail-Einladung zu. Plätze können jederzeit freigegeben und neu vergeben werden – z. B. nach bestandener Prüfung.' },
  { question: 'Gibt es Mengenrabatte für Schulen?', answer: 'Ja. Ab 10 Plätzen sinkt der Preis pro Schüler. Für größere Schulen mit 25+ Plätzen gibt es die günstigsten Konditionen.' },
  { question: 'Ist ExamFit DSGVO-konform?', answer: 'Ja. Alle Daten werden ausschließlich auf EU-Servern gehostet. Schulen erhalten eine ordentliche Rechnung. Betroffenenrechte (Auskunft, Löschung) werden automatisiert umgesetzt. Es gelten technisch-organisatorische Maßnahmen nach Art. 32 DSGVO.' },
  { question: 'Wie geht ExamFit mit KI und dem EU AI Act um?', answer: 'ExamFit setzt KI ausschließlich zur Unterstützung der Prüfungsvorbereitung ein. Alle KI-generierten Inhalte durchlaufen ein mehrstufiges Qualitätssystem mit menschlicher Aufsicht. Die eingesetzten Modelle und Datengrundlagen sind dokumentiert und transparent.' },
  { question: 'Werden Schülerdaten an Dritte weitergegeben?', answer: 'Nein. Individuelle Lernerdaten bleiben beim Schüler und der Schule. ExamFit gibt keine personenbezogenen Daten an Dritte weiter.' },
];

const CONTACT = {
  company: 'ExamFit',
  owner: 'Diana Keil',
  type: 'Einzelunternehmen',
  street: 'Elsa-Brandström-Str. 4',
  city: '76676 Graben-Neudorf',
  email: 'info@examfit.de',
};

const ausbildung = PRICING_CATEGORIES.ausbildung;
const TIERS = ausbildung.b2b.tiers.map(t => ({
  seats: t.seats,
  total: t.totalDisplay,
  perSeat: t.perSeatDisplay,
  highlight: t.seats === 10,
}));

export default function PruefungstrainingBerufsschulenPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Für Berufsschulen' },
  ];

  return (
    <>
      <SEOHead
        title={seoTitle('Prüfungstraining für Berufsschulen – Klassen-Lizenzen ab 27,90 €/Platz')}
        description="Prüfungsvorbereitung als Ergänzung zum Unterricht: Teamlizenzen für ganze Klassen, transparente Kompetenzstände pro Schüler, KI-Prüfungscoach und Lehrer-Dashboard."
        canonical={`${SITE_URL}/pruefungstraining-berufsschulen`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />
      <div className="min-h-screen">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="py-16 md:py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Für Berufsschulen' }]} />
            <Badge variant="outline" className="text-sm px-4 py-1.5">
              <GraduationCap className="h-3.5 w-3.5 mr-1.5" /> Für Berufsschulen &amp; Bildungsträger
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-tight">
              Prüfungsvorbereitung, die Unterricht{' '}
              <span className="text-gradient">ergänzt – nicht ersetzt.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              ExamFit unterstützt Ihre Schülerinnen und Schüler mit gezieltem Prüfungstraining –
              transparent für Lehrkräfte, motivierend für Lernende.
            </p>

            <div className="flex flex-wrap justify-center gap-4 text-sm font-medium">
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Eye className="h-4 w-4 text-primary" /> Kompetenzstände pro Klasse sichtbar
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Target className="h-4 w-4 text-primary" /> Prüfungsnah &amp; rahmenplankonform
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Shield className="h-4 w-4 text-primary" /> Kein Unterrichtsersatz
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">
                  Klassen-Lizenz kaufen <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg" asChild>
                <Link to="#pakete">Pakete vergleichen</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ═══════════════ USP: PLÄTZE FÜR KLASSEN ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl space-y-10">
            <div className="text-center space-y-3">
              <Badge variant="outline" className="text-xs px-3 py-1">
                <Shuffle className="h-3 w-3 mr-1" /> So funktioniert die Lizenz
              </Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold">
                Sie kaufen <span className="text-gradient">Plätze</span> – für alle Berufe
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Eine Teamlizenz für Ausbildung deckt alle Ausbildungsberufe ab.
                Egal ob Ihre Schule 3 oder 30 Berufsfelder betreut – eine Lizenz reicht.
              </p>
            </div>

            <Card className="max-w-lg mx-auto border-primary/20 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Beispiel: 25-Seat Lizenz für eine Berufsschule
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {SEAT_EXAMPLE.map((row, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground">{row.beruf}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  ✓ Verschiedene Klassen &amp; Berufe in einer Lizenz · ✓ Plätze jederzeit umverteilbar
                </p>
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: Shuffle, title: 'Flexibel über Klassen', desc: 'Plätze klassenübergreifend zuweisen – egal welcher Beruf.' },
                { icon: RefreshCw, title: 'Jährlich umverteilen', desc: 'Neues Schuljahr? Plätze freigeben und neu vergeben.' },
                { icon: UserPlus, title: 'Einfaches Onboarding', desc: 'Schüler per E-Mail einladen – kein technisches Setup.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="text-center p-5 rounded-xl border border-border bg-card">
                  <Icon className="h-8 w-8 text-primary mx-auto mb-3" />
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ PROBLEM → LÖSUNG ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-display font-bold text-center mb-12">
              Das Problem kennen <span className="text-gradient">alle Lehrkräfte</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" /> Ohne strukturiertes Training
                </h3>
                {[
                  'Prüfungsvorbereitung bleibt den Schülern selbst überlassen',
                  'Lehrkräfte sehen nicht, wer Lücken hat',
                  'Schwächen werden erst in der Prüfung sichtbar',
                  'Durchfallquoten belasten Schule und Betriebe',
                ].map(text => (
                  <div key={text} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-destructive mt-0.5">✗</span>{text}
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-5 w-5" /> Mit ExamFit
                </h3>
                {[
                  'Kompetenzstand pro Schüler und Klasse in Echtzeit',
                  'Risiko-Schüler werden frühzeitig erkannt',
                  'Gezielte Trainingsempfehlungen pro Schwäche',
                  'Transparente Ergebnisse für Elterngespräche & Konferenzen',
                ].map(text => (
                  <div key={text} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />{text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ LEHRER-DASHBOARD ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Das <span className="text-gradient">Lehrer-Dashboard</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Sehen Sie auf einen Blick, welche Schüler prüfungsbereit sind – und wer noch Unterstützung braucht.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="h-8 w-8 text-primary mx-auto mb-2" />
                  <div className="text-3xl font-bold text-gradient mb-1">82%</div>
                  <p className="text-xs text-muted-foreground">Ø Prüfungsreife Klasse 10a</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                  <div className="text-3xl font-bold text-warning mb-1">4</div>
                  <p className="text-xs text-muted-foreground">Schüler mit Risiko (&lt;50%)</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <Brain className="h-8 w-8 text-success mx-auto mb-2" />
                  <div className="text-3xl font-bold text-success mb-1">KI-Coach</div>
                  <p className="text-xs text-muted-foreground">Individuelle Schwächenanalyse</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ═══════════════ ABGRENZUNG ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-4xl">
            <div className="glass-card rounded-2xl p-8 md:p-12">
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-6 text-center">
                Klare <span className="text-gradient">Abgrenzung</span>
              </h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h3 className="font-semibold text-destructive mb-3">ExamFit ist NICHT:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {['Eine Lernplattform für den Unterricht', 'Konkurrenz zur Berufsschule', 'Ein Ersatz für Fachunterricht'].map(t => (
                      <li key={t} className="flex items-start gap-2">
                        <span className="text-destructive mt-0.5">✗</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-3">ExamFit IST:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {['Ergänzendes Prüfungstraining zur Selbstvorbereitung', 'Transparenz-Tool für Lehrkräfte', 'Orientiert am Ausbildungsrahmenplan'].map(t => (
                      <li key={t} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />{t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ EINSATZFORMEN ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Typische <span className="text-gradient">Einsatzformen</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                'Empfehlung als Tool zur individuellen Prüfungsvorbereitung',
                'Ergänzung zum Unterricht in der Prüfungsphase',
                'Gezielte Förderung leistungsschwächerer Schüler',
                'Klassenbezogene Kompetenzanalyse für Konferenzen',
              ].map(text => (
                <div key={text} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ PRICING ═══════════════ */}
        <section id="pakete" className="py-16 md:py-20">
          <div className="container max-w-5xl space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-display font-bold">
                Klassen-Lizenzen – <span className="text-gradient">transparent &amp; fair</span>
              </h2>
              <p className="text-muted-foreground">Jährlich. Zugriff auf alle Ausbildungsberufe innerhalb der Kategorie.</p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                { seats: 5, label: 'Kleine Klasse / AG', desc: 'Für Fördergruppen oder einzelne Klassen.' },
                { seats: 10, label: 'Mittlere Klasse', desc: 'Für durchschnittlich große Berufsschulklassen.' },
                { seats: 25, label: 'Mehrere Klassen', desc: 'Für Schulen mit mehreren Berufsfeldern.' },
              ].map(rec => (
                <div key={rec.seats} className="text-center p-4 rounded-xl border border-border bg-card">
                  <p className="text-2xl font-bold text-gradient">{rec.seats} Plätze</p>
                  <p className="font-semibold text-sm mt-1">{rec.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{rec.desc}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              {TIERS.map(tier => (
                <Card key={tier.seats} className={`relative text-center ${tier.highlight ? 'ring-2 ring-primary shadow-lg scale-105' : ''}`}>
                  {tier.highlight && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                      Für Klassen ideal
                    </Badge>
                  )}
                  <CardHeader className="pt-8 pb-2">
                    <p className="text-sm text-muted-foreground">{tier.seats} Plätze</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <span className="text-4xl font-bold text-gradient">{tier.perSeat}</span>
                      <span className="text-muted-foreground text-sm"> / Platz / Jahr</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Gesamt: {tier.total}</p>
                    <Button className={`w-full ${tier.highlight ? 'gradient-primary text-primary-foreground shadow-glow' : ''}`} variant={tier.highlight ? 'default' : 'outline'} asChild>
                      <Link to="/shop">{tier.seats} Plätze kaufen <ArrowRight className="ml-1 h-4 w-4" /></Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Alle Ausbildungsberufe enthalten</span>
              <span className="flex items-center gap-1.5"><RefreshCw className="h-4 w-4 text-primary" /> Jährlich umverteilbar</span>
              <span className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-primary" /> DSGVO-konform</span>
            </div>
          </div>
        </section>

        {/* ═══════════════ FAQ ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-3xl space-y-6">
            <h2 className="text-2xl font-bold text-center">Häufige Fragen</h2>
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

        {/* ═══════════════ KONTAKT ═══════════════ */}
        <section className="py-12 border-t border-border">
          <div className="container max-w-4xl text-center space-y-2">
            <p className="font-semibold">{CONTACT.company}</p>
            <p className="text-sm text-muted-foreground">Inhaberin: {CONTACT.owner} · {CONTACT.type}</p>
            <p className="text-sm text-muted-foreground">{CONTACT.street} · {CONTACT.city}</p>
            <p className="text-sm text-muted-foreground">{CONTACT.email}</p>
          </div>
        </section>


        <section className="py-20">
          <div className="container max-w-4xl">
            <div className="glass-strong rounded-3xl p-10 md:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10 space-y-6">
                <GraduationCap className="h-14 w-14 text-primary mx-auto" />
                <h2 className="text-3xl md:text-4xl font-display font-bold">
                  Prüfungsvorbereitung für Ihre Klassen starten
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto text-lg">
                  Starten Sie mit 10 Plätzen und machen Sie Prüfungsreife klassenübergreifend sichtbar.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                    <Link to="/shop">Jetzt Klassen-Lizenz sichern <ArrowRight className="ml-2 h-5 w-5" /></Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                    <Link to="/enterprise-demo">Demo ansehen</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Kein Risiko. Jährlich kündbar. Zugriff bleibt bis Periodenende bestehen.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
