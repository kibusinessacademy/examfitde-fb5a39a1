import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { generateBreadcrumbSchema, generateFAQSchema, SITE_URL, seoTitle } from '@/lib/seo';
import { PRICING_CATEGORIES } from '@/config/pricing';
import {
  ArrowRight, CheckCircle2, GraduationCap, Brain, Target,
  BarChart3, AlertTriangle, XCircle, Clock3, Search,
  TrendingUp, BookOpen, Users, Shuffle, RefreshCw, UserPlus,
  Shield, Building2,
} from 'lucide-react';

/* ─── B2C: Individual pain + solution ─── */
const PAIN_POINTS = [
  { icon: XCircle, title: 'Zu viel Stoff', text: 'Im Studium scheitert Prüfungsvorbereitung oft nicht an zu wenig Material, sondern an zu wenig Struktur.' },
  { icon: AlertTriangle, title: 'Transfer statt Wiedergabe', text: 'Die Klausur fragt nicht „Was ist X?" – sondern „Wie wendest du X in Situation Y an?"' },
  { icon: Clock3, title: 'Unsicheres Leistungsgefühl', text: 'Zu wenig Zeit, unklar was relevant ist, unsicheres Gefühl trotz Lernen.' },
];

/* ─── Seat example for universities ─── */
const SEAT_EXAMPLE = [
  { name: 'Gruppe A', fach: 'BWL – Grundlagen', seats: 8 },
  { name: 'Gruppe B', fach: 'Wirtschaftsinformatik', seats: 6 },
  { name: 'Gruppe C', fach: 'Wirtschaftsrecht', seats: 5 },
];

const FAQS = [
  { question: 'Was ist der Unterschied zwischen ExamFit und einer klassischen Lernplattform?', answer: 'ExamFit ist auf Prüfungstraining ausgerichtet. Statt vor allem Inhalte bereitzustellen, unterstützt das System dabei, prüfungsrelevante Aufgaben zu trainieren, Schwächen sichtbar zu machen und gezielt auf die Klausur hinzuarbeiten.' },
  { question: 'Ersetzt ExamFit Vorlesungen oder Fachliteratur?', answer: 'Nein. ExamFit ergänzt bestehende Lernwege um ein System für gezieltes Klausurtraining und messbare Vorbereitung.' },
  { question: 'Für welche Studiengänge ist ExamFit verfügbar?', answer: 'Aktuell bieten wir Klausurtraining für über 20 Studiengänge, darunter BWL, Wirtschaftsinformatik, Informatik, Maschinenbau, Jura und weitere MINT- sowie Wirtschaftsfächer.' },
  { question: 'Können Dozenten die Fortschritte einsehen?', answer: 'Ja. Über das Dozenten-Dashboard sehen Lehrende den Kompetenzstand der Studierenden, Risiko-Einschätzungen und den Trainingsfortschritt – pro Kurs oder Seminargruppe.' },
  { question: 'Funktioniert eine Lizenz für verschiedene Studiengänge?', answer: 'Ja! Eine Teamlizenz für Studium deckt alle verfügbaren Studiengänge ab. BWL, Informatik oder Maschinenbau – alle nutzen dieselbe Lizenz.' },
  { question: 'Ist ExamFit DSGVO-konform?', answer: 'Ja. Alle Daten werden ausschließlich auf EU-Servern verarbeitet. Studierende können jederzeit Auskunft über ihre Daten verlangen oder deren Löschung beantragen. Hochschulen erhalten eine ordentliche Rechnung mit ausgewiesener MwSt.' },
  { question: 'Wie geht ExamFit mit KI um (EU AI Act)?', answer: 'ExamFit dokumentiert alle eingesetzten KI-Modelle transparent. Alle KI-generierten Inhalte durchlaufen ein mehrstufiges Qualitätssystem mit menschlicher Aufsicht. Die Datengrundlagen sind nachvollziehbar und revisionssicher.' },
  { question: 'Werden Studierendendaten an die Hochschule weitergegeben?', answer: 'Nur wenn die Hochschule eine Teamlizenz nutzt: Dann sehen Dozenten den Kompetenzstand ihrer Studierenden. Individuelle Lernerdaten werden nie an Dritte weitergegeben.' },
  { question: 'Gibt es Konditionen für Universitäten und Hochschulen?', answer: 'Ja. Ab 10 Plätzen sinkt der Preis pro Studierendem. Für Hochschulen mit 25+ Plätzen bieten wir die günstigsten Konditionen. Kontaktieren Sie uns unter info@examfit.de.' },
];

const CONTACT = {
  company: 'ExamFit',
  owner: 'Diana Keil',
  type: 'Einzelunternehmen',
  street: 'Elsa-Brandström-Str. 4',
  city: '76676 Graben-Neudorf',
  email: 'info@examfit.de',
};

const studium = PRICING_CATEGORIES.studium;
const TIERS = studium.b2b.tiers.map(t => ({
  seats: t.seats,
  total: t.totalDisplay,
  perSeat: t.perSeatDisplay,
  highlight: t.seats === 10,
}));

export default function PruefungstrainingStudiumPage() {
  const breadcrumbs = [
    { name: 'Start', url: SITE_URL },
    { name: 'Klausurtraining Studium' },
  ];

  return (
    <>
      <SEOHead
        title={seoTitle('Klausurtraining fürs Studium – Prüfungsvorbereitung für Studierende & Hochschulen')}
        description="Gezielte Klausurvorbereitung im Studium: Transferaufgaben, KI-Prüfungscoach und messbarer Lernfortschritt. Für Einzelpersonen ab 39,90 € und Hochschulen ab 35,96 €/Platz."
        canonical={`${SITE_URL}/pruefungstraining-studium`}
        structuredData={[generateBreadcrumbSchema(breadcrumbs), generateFAQSchema(FAQS)]}
      />
      <div className="min-h-screen">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="py-16 md:py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-accent/5" />
          <div className="container relative z-10 max-w-4xl text-center space-y-6">
            <Breadcrumbs items={[{ label: 'Start', href: '/' }, { label: 'Klausurtraining Studium' }]} />
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle animate-fade-in">
              <GraduationCap className="h-4 w-4 text-accent" />
              <span className="text-sm text-muted-foreground">Klausurtraining · Transferaufgaben · Prüfungsreife</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-tight animate-fade-in">
              Klausuren bestehen –{' '}
              <span className="text-gradient text-glow">gezielt statt auf Stoffberge.</span>
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Bereite dich strukturiert auf Hochschulprüfungen vor: mit fokussiertem Training,
              Transferaufgaben und klarer Rückmeldung zu deinem Leistungsstand.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in pt-2" style={{ animationDelay: '0.2s' }}>
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg group" asChild>
                <Link to="/shop">
                  Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg" asChild>
                <Link to="/pruefungsreife-check">Wissensstand testen</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ═══════════════ PAIN POINTS ═══════════════ */}
        <section className="py-12 sm:py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              Warum klassische Vorbereitung <span className="text-gradient">oft nicht reicht</span>
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
              {PAIN_POINTS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-destructive mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-muted-foreground mt-8 max-w-2xl mx-auto">
              ExamFit hilft dir, den Stoff auf prüfungsrelevante Aufgabenlogik herunterzubrechen.
            </p>
          </div>
        </section>

        {/* ═══════════════ USP ═══════════════ */}
        <section className="py-12 sm:py-16">
          <div className="container max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-center mb-10">
              So unterstützt ExamFit deine <span className="text-gradient">Klausurvorbereitung</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { icon: Target, title: 'Strukturierte Vorbereitung', text: 'Trainiere in Formaten, die dich auf echte Klausursituationen vorbereiten.' },
                { icon: BarChart3, title: 'Transferaufgaben', text: 'Übe Fallanalysen, Modellvergleiche und Transferaufgaben – die häufigsten Stolpersteine.' },
                { icon: Search, title: 'Schwächenanalyse', text: 'Erkenne, wo du noch unsicher bist und woran du gezielt arbeiten solltest.' },
                { icon: Brain, title: 'KI-Klausurcoach', text: 'Erklärt Fehler, zeigt typische Klausurfallen und trainiert gezielt Schwächen.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <Icon className="h-10 w-10 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ B2C PRICING ═══════════════ */}
        <section className="py-12 sm:py-16 bg-muted/30">
          <div className="container max-w-3xl text-center space-y-6">
            <h2 className="text-3xl font-display font-bold">
              Für <span className="text-gradient">Einzelpersonen</span>
            </h2>
            <Card className="max-w-sm mx-auto border-primary/20">
              <CardContent className="pt-6 text-center space-y-3">
                <GraduationCap className="h-10 w-10 text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">Klausurtraining Studium</p>
                <div>
                  <span className="text-4xl font-bold text-gradient">{studium.priceDisplay}</span>
                  <span className="text-muted-foreground text-sm"> einmalig</span>
                </div>
                <p className="text-xs text-muted-foreground">{studium.access} Zugriff · Alle Studiengänge</p>
                <Button className="w-full gradient-primary text-primary-foreground shadow-glow" asChild>
                  <Link to="/shop">Jetzt starten <ArrowRight className="ml-1 h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ═══════════════ B2B: FÜR HOCHSCHULEN ═══════════════ */}
        <section className="py-16 md:py-20">
          <div className="container max-w-4xl space-y-10">
            <div className="text-center space-y-3">
              <Badge variant="outline" className="text-xs px-3 py-1">
                <Building2 className="h-3 w-3 mr-1" /> Für Hochschulen &amp; Universitäten
              </Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold">
                Sie kaufen <span className="text-gradient">Plätze</span> – für alle Studiengänge
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Eine Teamlizenz für Studium deckt alle verfügbaren Studiengänge ab.
                BWL, Informatik oder Maschinenbau – alle Studierenden nutzen dieselbe Lizenz.
              </p>
            </div>

            <Card className="max-w-lg mx-auto border-primary/20 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Beispiel: Teamlizenz für einen Fachbereich
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {SEAT_EXAMPLE.map((row, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-muted-foreground">{row.fach}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  ✓ Verschiedene Studiengänge in einer Lizenz · ✓ Plätze semesterweise umverteilbar
                </p>
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: Shuffle, title: 'Fachbereichs-übergreifend', desc: 'Plätze über verschiedene Studiengänge hinweg zuweisen.' },
                { icon: RefreshCw, title: 'Semesterweise umverteilen', desc: 'Neues Semester? Plätze freigeben und neu vergeben.' },
                { icon: UserPlus, title: 'Einfaches Onboarding', desc: 'Studierende per E-Mail einladen – kein technisches Setup.' },
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

        {/* ═══════════════ DOZENTEN-DASHBOARD ═══════════════ */}
        <section className="py-16 md:py-20 bg-muted/30">
          <div className="container max-w-4xl text-center space-y-8">
            <h2 className="text-3xl font-display font-bold">
              Das <span className="text-gradient">Dozenten-Dashboard</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Sehen Sie auf einen Blick, welche Studierenden klausurbereit sind – und wer noch Unterstützung braucht.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="h-8 w-8 text-primary mx-auto mb-2" />
                  <div className="text-3xl font-bold text-gradient mb-1">74%</div>
                  <p className="text-xs text-muted-foreground">Ø Klausurreife Seminargruppe</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                  <div className="text-3xl font-bold text-warning mb-1">6</div>
                  <p className="text-xs text-muted-foreground">Studierende mit Risiko (&lt;50%)</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardContent className="pt-6 text-center">
                  <TrendingUp className="h-8 w-8 text-success mx-auto mb-2" />
                  <div className="text-3xl font-bold text-success mb-1">89%</div>
                  <p className="text-xs text-muted-foreground">Trainingsaktivität (7 Tage)</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ═══════════════ HOCHSCHUL-PRICING ═══════════════ */}
        <section id="pakete" className="py-16 md:py-20">
          <div className="container max-w-5xl space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-display font-bold">
                Hochschul-Lizenzen – <span className="text-gradient">transparent &amp; fair</span>
              </h2>
              <p className="text-muted-foreground">Jährlich. Zugriff auf alle Studiengänge innerhalb der Kategorie.</p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                { seats: 5, label: 'Seminargruppe', desc: 'Für kleine Kurse oder Tutorien.' },
                { seats: 10, label: 'Vorlesungsbegleitend', desc: 'Für mittlere Kurse oder Fachbereiche.' },
                { seats: 25, label: 'Fachbereich / Fakultät', desc: 'Für übergreifende Klausurvorbereitung.' },
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
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">Für Kurse ideal</Badge>
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
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Alle Studiengänge enthalten</span>
              <span className="flex items-center gap-1.5"><RefreshCw className="h-4 w-4 text-primary" /> Semesterweise umverteilbar</span>
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
                  Bereit für dein Klausurtraining?
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto text-lg">
                  Starte jetzt als Einzelperson oder sichere Plätze für deine Hochschule.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg" asChild>
                    <Link to="/shop">Jetzt Klausurtraining starten <ArrowRight className="ml-2 h-5 w-5" /></Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8" asChild>
                    <Link to="/enterprise-demo">Hochschul-Demo ansehen</Link>
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
