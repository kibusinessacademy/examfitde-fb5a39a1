import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Users, BarChart3, ShieldCheck, AlertTriangle,
  CheckCircle2, TrendingUp, Building2, Target, Brain, Zap,
  CreditCard, RefreshCw, UserPlus, Shuffle, Calculator,
} from 'lucide-react';
import { PRICING_CATEGORIES, CATEGORY_ORDER, type PricingCategory } from '@/config/pricing';

/* ─── Seat example table ─── */
const SEAT_EXAMPLE = [
  { name: 'Max', beruf: 'Automobilkaufmann' },
  { name: 'Lisa', beruf: 'Büromanagement' },
  { name: 'Tim', beruf: 'Asphaltbauer' },
  { name: 'Anna', beruf: 'Verwaltungsfachangestellte' },
  { name: 'Paul', beruf: 'Industriekaufmann' },
];

/* ─── FAQs ─── */
const FAQS = [
  {
    question: 'Funktioniert ExamFit für verschiedene Ausbildungsberufe gleichzeitig?',
    answer: 'Ja! Sie kaufen Plätze, keine Kurse. Innerhalb einer Kategorie (z. B. Ausbildung) können Sie jeden Platz für einen beliebigen Beruf nutzen – Automobilkaufmann, Büromanagement, Industriekaufmann oder jeden anderen.',
  },
  {
    question: 'Kann ich Plätze umverteilen, wenn ein Azubi die Prüfung bestanden hat?',
    answer: 'Ja. Plätze können jederzeit freigegeben und neu zugewiesen werden – ohne zusätzliche Kosten.',
  },
  {
    question: 'Was passiert nach 12 Monaten?',
    answer: 'Die Lizenz verlängert sich automatisch. Sie können jederzeit kündigen – der Zugriff bleibt bis zum Ende der bezahlten Periode bestehen.',
  },
  {
    question: 'Kann ich die Prüfungsreife meiner Azubis einsehen?',
    answer: 'Ja. Das Admin-Dashboard zeigt Ihnen für jeden Auszubildenden die aktuelle Bestehenswahrscheinlichkeit, Stärken-/Schwächenprofil und den Trainingsfortschritt.',
  },
  {
    question: 'Erhalte ich eine ordentliche Rechnung?',
    answer: 'Ja, Sie erhalten automatisch eine Rechnung mit ausgewiesener MwSt. für Ihre Buchhaltung.',
  },
  {
    question: 'Ist ExamFit DSGVO-konform?',
    answer: 'Ja. Alle Daten werden ausschließlich auf EU-Servern gespeichert und verarbeitet. ExamFit erfüllt die Anforderungen der DSGVO vollständig: Datenminimierung, Zweckbindung, Auskunfts- und Löschrechte für Nutzer sowie technisch-organisatorische Maßnahmen nach Art. 32 DSGVO.',
  },
  {
    question: 'Wie geht ExamFit mit dem EU AI Act um?',
    answer: 'ExamFit ist als KI-System im Bildungsbereich gemäß EU AI Act klassifiziert. Wir gewährleisten lückenlose Dokumentation aller KI-Entscheidungen, menschliche Aufsicht über alle KI-generierten Inhalte durch ein mehrstufiges Quality-Gate-System und volle Transparenz über eingesetzte Modelle und Datengrundlagen.',
  },
  {
    question: 'Wer hat Zugriff auf die Lernerdaten meiner Mitarbeiter?',
    answer: 'Nur Sie als Lizenznehmer und die zugewiesenen Nutzer selbst. ExamFit gibt keine individuellen Lernerdaten an Dritte weiter. Aggregierte, anonymisierte Auswertungen stehen Ihnen im Admin-Dashboard zur Verfügung.',
  },
  {
    question: 'Ab wie vielen Azubis lohnt sich das?',
    answer: 'Bereits ab 5 Plätzen profitieren Sie von Mengenrabatten und dem Ausbilder-Dashboard. Die meisten Betriebe starten mit 5–10 Plätzen.',
  },
];

const CONTACT = {
  company: 'ExamFit',
  owner: 'Diana Keil',
  type: 'Einzelunternehmen',
  street: 'Elsa-Brandström-Str. 4',
  city: '76676 Graben-Neudorf',
  email: 'info@examfit.de',
};

/* ─── Pricing tiers for "Ausbildung" category (primary B2B target) ─── */
const ausbildung = PRICING_CATEGORIES.ausbildung;
const TIERS = ausbildung.b2b.tiers.map(t => ({
  seats: t.seats,
  total: t.totalDisplay,
  perSeat: t.perSeatDisplay,
  highlight: t.seats === 10,
}));

export default function BetriebeLandingPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Für Betriebe' },
  ];

  return (
    <>
      <SEOHead
        title="ExamFit für Betriebe – Prüfungstraining für Ausbildungsbetriebe | Ab 29,80 €/Platz"
        description="Bestehensquoten erhöhen, Durchfallrisiken erkennen: Seat-basierte Teamlizenzen, Prüfungsreife-Dashboard und KI-Prüfungscoach für alle Ausbildungsberufe. Ab 29,80 €/Platz pro Jahr."
        canonical={`${SITE_URL}/betriebe`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />

      <div className="min-h-screen">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="py-16 md:py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Für Betriebe' }]} />
            <Badge variant="outline" className="text-sm px-4 py-1.5">
              <Building2 className="h-3.5 w-3.5 mr-1.5" /> Für Ausbildungsbetriebe &amp; Bildungsträger
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-tight">
              Bestehensquoten erhöhen.{' '}
              <span className="text-gradient">Ausbildungsqualität messbar machen.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              ExamFit ist das intelligente Prüfungstraining für Ausbildungsbetriebe –
              mit echten Prüfungsaufgaben, automatischen Auswertungen und KI-gestütztem Coaching.
            </p>

            {/* 3 Killer-Benefits */}
            <div className="flex flex-wrap justify-center gap-4 text-sm font-medium">
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Prüfungsreife jederzeit sichtbar
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Target className="h-4 w-4 text-primary" /> Training exakt auf Prüfung ausgerichtet
              </span>
              <span className="flex items-center gap-1.5 bg-card border border-border rounded-full px-4 py-2">
                <Zap className="h-4 w-4 text-primary" /> Kein zusätzlicher Schulungsaufwand
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                <Link to="/shop">
                  Lizenzen für Auszubildende kaufen <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg" asChild>
                <Link to="#pakete">
                  Pakete vergleichen
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ═══════════════ USP: PLÄTZE STATT KURSE ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl space-y-10">
            <div className="text-center space-y-3">
              <Badge variant="outline" className="text-xs px-3 py-1">
                <Shuffle className="h-3 w-3 mr-1" /> So funktioniert die Lizenz
              </Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold">
                Sie kaufen <span className="text-gradient">Plätze</span> – keine Kurse
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Eine Teamlizenz für Ausbildung deckt alle Ausbildungsberufe ab.
                Ihre Auszubildenden trainieren genau die Inhalte, die sie für ihre Prüfung brauchen.
              </p>
            </div>

            {/* Seat example table */}
            <Card className="max-w-lg mx-auto border-primary/20 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Beispiel: 5-Seat Lizenz „Ausbildung"
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
                  ✓ Alle nutzen dieselbe Lizenz · ✓ Plätze jederzeit neu zuweisbar
                </p>
              </CardContent>
            </Card>

            {/* 3 advantages */}
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: Shuffle, title: 'Flexibel zuweisen', desc: 'Egal welcher Beruf – einfach Platz zuweisen und loslegen.' },
                { icon: RefreshCw, title: 'Plätze umverteilen', desc: 'Azubi fertig? Platz freigeben und neu vergeben.' },
                { icon: UserPlus, title: 'Einfaches Onboarding', desc: 'Per E-Mail einladen – kein technisches Setup nötig.' },
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
              Das Problem kennen <span className="text-gradient">alle Ausbilder</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {/* Problem */}
              <div className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" /> Ohne ExamFit
                </h3>
                {[
                  'Azubis lernen „irgendwas" – ohne System',
                  'Prüfungsvorbereitung ist nicht messbar',
                  'Schwächen werden zu spät erkannt',
                  'Durchfallquote kostet Zeit und Geld',
                ].map(text => (
                  <div key={text} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-destructive mt-0.5">✗</span>
                    {text}
                  </div>
                ))}
              </div>
              {/* Solution */}
              <div className="space-y-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-5 w-5" /> Mit ExamFit
                </h3>
                {[
                  'Bestehenswahrscheinlichkeit pro Azubi in Echtzeit',
                  'Risiko-Azubis werden automatisch erkannt',
                  'Gezielte Trainingsempfehlungen pro Schwäche',
                  'Messbare Ergebnisse für Ihr Reporting',
                ].map(text => (
                  <div key={text} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ DASHBOARD PREVIEW ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Das <span className="text-gradient">Ausbilder-Dashboard</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              ExamFit zeigt Ihnen frühzeitig, ob ein Azubi die Prüfung bestehen wird.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="h-8 w-8 text-primary mx-auto mb-2" />
                  <div className="text-3xl font-bold text-gradient mb-1">87%</div>
                  <p className="text-xs text-muted-foreground">Ø Bestehenswahrscheinlichkeit</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                  <div className="text-3xl font-bold text-warning mb-1">3</div>
                  <p className="text-xs text-muted-foreground">Azubis mit Risiko (&lt;50%)</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <TrendingUp className="h-8 w-8 text-success mx-auto mb-2" />
                  <div className="text-3xl font-bold text-success mb-1">92%</div>
                  <p className="text-xs text-muted-foreground">Trainingsaktivität (7 Tage)</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ═══════════════ FUNKTIONEN ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-4xl space-y-8">
            <h2 className="text-3xl font-display font-bold text-center">
              Was Ihre Teamlizenz <span className="text-gradient">beinhaltet</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-5">
              {[
                { icon: BarChart3, title: 'Prüfungsreife auf einen Blick', desc: 'Score je Azubi, Risikobewertung und klare Handlungsempfehlungen.' },
                { icon: Brain, title: 'KI-Prüfungscoach', desc: 'Erklärt Fehler, zeigt typische Prüfungsfallen und trainiert gezielt Schwächen.' },
                { icon: Target, title: 'Prüfungssimulation', desc: 'Realistische Bedingungen, Zeitdruck und Bewertung wie bei IHK.' },
                { icon: Zap, title: 'Frühwarnsystem', desc: 'Automatische Benachrichtigung bei sinkender Bestehenswahrscheinlichkeit.' },
                { icon: Users, title: 'Seat-Verwaltung', desc: 'Plätze per E-Mail zuweisen, freigeben und umverteilen – in Sekunden.' },
                { icon: ShieldCheck, title: 'DSGVO-konform', desc: 'EU-Hosting, datenschutzkonform und mit ordentlicher Rechnung.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
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

        {/* ═══════════════ ROI BLOCK ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-3xl text-center space-y-6">
            <Calculator className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-3xl font-display font-bold">
              Die <span className="text-gradient">Rechnung</span> ist einfach
            </h2>
            <div className="grid sm:grid-cols-2 gap-6 text-left max-w-xl mx-auto">
              <Card className="border-destructive/20">
                <CardContent className="pt-6 space-y-2">
                  <p className="font-semibold text-destructive text-sm">Kosten eines Durchfallers</p>
                  <p className="text-3xl font-bold">1.000 €+</p>
                  <p className="text-xs text-muted-foreground">
                    Zeit, Betreuung, Wiederholungsprüfung, verzögerter Einsatz
                  </p>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-6 space-y-2">
                  <p className="font-semibold text-primary text-sm">ExamFit pro Azubi</p>
                  <p className="text-3xl font-bold text-gradient">29,80 €</p>
                  <p className="text-xs text-muted-foreground">
                    Pro Jahr. Verhindert Nachprüfungen, Verzögerungen und Mehraufwand.
                  </p>
                </CardContent>
              </Card>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Schon <strong>ein einziger vermiedener Durchfaller</strong> zahlt die Teamlizenz für 30+ Azubis.
            </p>
          </div>
        </section>

        {/* ═══════════════ PRICING ═══════════════ */}
        <section id="pakete" className="py-16 md:py-20">
          <div className="container max-w-5xl space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-display font-bold">
                Teamlizenzen – <span className="text-gradient">transparent &amp; fair</span>
              </h2>
              <p className="text-muted-foreground">Jährlich. Jederzeit kündbar. Zugriff auf alle Ausbildungsberufe innerhalb der Kategorie.</p>
            </div>

            {/* Tier recommendation block */}
            <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                { seats: 5, label: 'Kleine Betriebe', desc: 'Ideal für Betriebe mit wenigen Auszubildenden oder zum Einstieg.' },
                { seats: 10, label: 'Wachsende Teams', desc: 'Für Betriebe mit mehreren Berufen oder Standorten.' },
                { seats: 25, label: 'Größere Standorte', desc: 'Für zentrale Ausbildungssteuerung und übergreifendes Reporting.' },
              ].map(rec => (
                <div key={rec.seats} className="text-center p-4 rounded-xl border border-border bg-card">
                  <p className="text-2xl font-bold text-gradient">{rec.seats} Plätze</p>
                  <p className="font-semibold text-sm mt-1">{rec.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{rec.desc}</p>
                </div>
              ))}
            </div>

            {/* Ausbildung tiers */}
            <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              {TIERS.map(tier => (
                <Card
                  key={tier.seats}
                  className={`relative text-center ${tier.highlight ? 'ring-2 ring-primary shadow-lg scale-105' : ''}`}
                >
                  {tier.highlight && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                      Beliebteste Wahl
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
                    <Button
                      className={`w-full ${tier.highlight ? 'gradient-primary text-primary-foreground shadow-glow' : ''}`}
                      variant={tier.highlight ? 'default' : 'outline'}
                      asChild
                    >
                      <Link to="/shop">
                        {tier.seats} Plätze kaufen <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Zugriff auf alle Ausbildungsberufe
              </span>
              <span className="flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-primary" /> Automatische Verlängerung
              </span>
              <span className="flex items-center gap-1.5">
                <Shuffle className="h-4 w-4 text-primary" /> Plätze jederzeit neu zuweisbar
              </span>
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-primary" /> Jährlich kündbar
              </span>
            </div>

            {/* Other categories hint */}
            <div className="text-center pt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Teamlizenzen auch verfügbar für:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {CATEGORY_ORDER.filter(c => c !== 'ausbildung').map(cat => (
                  <Badge key={cat} variant="outline" className="text-xs">
                    {PRICING_CATEGORIES[cat].label} – ab {PRICING_CATEGORIES[cat].b2b.tiers[0].perSeatDisplay}/Platz
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ USE CASES ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-display font-bold text-center mb-10">
              Typische <span className="text-gradient">Einsatzszenarien</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                'Vorbereitung auf IHK-Abschlussprüfung Teil 1 & 2',
                'Gezielte Förderung leistungsschwacher Azubis',
                'Qualitätssicherung im Ausbildungsprozess',
                'Standardisiertes Training über mehrere Standorte',
              ].map(text => (
                <div key={text} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ SOCIAL PROOF ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-3xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Warum Betriebe <span className="text-gradient">ExamFit vertrauen</span>
            </h2>
            <div className="flex flex-wrap justify-center gap-12">
              <div>
                <p className="text-4xl font-display font-bold text-gradient">200+</p>
                <p className="text-sm text-muted-foreground">Ausbildungsberufe abgedeckt</p>
              </div>
              <div>
                <p className="text-4xl font-display font-bold text-gradient">IHK / HWK</p>
                <p className="text-sm text-muted-foreground">Prüfungsrelevante Inhalte</p>
              </div>
              <div>
                <p className="text-4xl font-display font-bold text-gradient">DSGVO</p>
                <p className="text-sm text-muted-foreground">EU-Hosting & datenschutzkonform</p>
              </div>
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
                  <summary className="px-6 py-4 cursor-pointer font-medium hover:text-primary transition-colors">
                    {faq.question}
                  </summary>
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
            <p className="text-sm text-muted-foreground">
              Inhaberin: {CONTACT.owner} · {CONTACT.type}
            </p>
            <p className="text-sm text-muted-foreground">
              {CONTACT.street} · {CONTACT.city}
            </p>
            <p className="text-sm text-muted-foreground">
              {CONTACT.email}
            </p>
          </div>
        </section>

        {/* ═══════════════ FINAL CTA ═══════════════ */}
        <section className="py-20">
          <div className="container max-w-4xl">
            <div className="glass-strong rounded-3xl p-10 md:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10 space-y-6">
                <Building2 className="h-14 w-14 text-primary mx-auto" />
                <h2 className="text-3xl md:text-4xl font-display font-bold">
                  Bereit für messbare Prüfungsergebnisse?
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto text-lg">
                  Starten Sie mit 5 Plätzen und machen Sie Prüfungsreife innerhalb kurzer Zeit sichtbar.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                    <Link to="/shop">
                      Jetzt Teamlizenz sichern <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                    <Link to="/enterprise-demo">
                      Demo ansehen
                    </Link>
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
