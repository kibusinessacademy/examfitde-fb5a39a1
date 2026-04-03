import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  Brain,
  Target,
  BarChart3,
  BookOpen,
  Clock3,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Lightbulb,
  FileText,
  Sparkles,
  Users,
  Building,
  Mail,
  XCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle } from '@/lib/seo';
import { ctaProps, trackConversion } from '@/lib/seo-tracking';

/* ── data ── */

const trustBadges = [
  'Klausurtraining, nicht Wissensvermittlung',
  'Prüfungsreife messbar ab Tag 1',
  'Kein Abo – einmalig',
];

const painPoints = [
  {
    icon: XCircle,
    title: 'Du lernst alles – und wirst trotzdem überrascht',
    text: 'Weil die Klausur nicht fragt „Was ist X?" – sondern „Wie wendest du X in Situation Y an?"',
  },
  {
    icon: AlertTriangle,
    title: 'Du verstehst den Stoff – aber kannst ihn nicht anwenden',
    text: 'Transfer, Fallanalysen und Modellvergleiche sind die häufigsten Stolpersteine in Modulprüfungen.',
  },
  {
    icon: Clock3,
    title: 'Du weißt nicht, ob es wirklich reicht',
    text: 'Ohne Prüfungssimulation und echte Diagnose bleibt alles Bauchgefühl – bis zur Klausur.',
  },
];

const compareRows: [string, string][] = [
  ['Inhalte vermitteln', 'Prüfungserfolg trainieren'],
  ['Theorie wiederholen', 'Anwendung & Transfer üben'],
  ['Wissen testen', 'Prüfungslogik verstehen'],
  ['Zusammenfassungen lesen', 'Fallanalysen lösen'],
  ['„Hast du gelernt?"', '„Bist du prüfungsreif?"'],
];

const steps = [
  {
    title: 'Prüfungslogik verstehen',
    text: 'Wie sind Klausuren aufgebaut? Welche Fragetypen kommen? Wo sind typische Denkfehler?',
  },
  {
    title: 'Transfer trainieren',
    text: 'Wissen anwenden, neue Situationen analysieren, Modelle in echten Kontexten einsetzen.',
  },
  {
    title: 'Schwächen gezielt schließen',
    text: 'Das System zeigt dir exakt, wo du Punkte verlierst – und trainiert genau dort.',
  },
  {
    title: 'Klausur simulieren',
    text: 'Zeitdruck, Struktur, Bewertung – du trainierst unter echten Prüfungsbedingungen.',
  },
];

const features = [
  {
    icon: FileText,
    title: 'Prüfungstrainer',
    points: ['Fallanalysen', 'Transferaufgaben', 'Modellvergleiche', 'Bewertungsfragen'],
  },
  {
    icon: Clock3,
    title: 'Klausursimulation',
    points: ['Zeitdruck', 'realistische Struktur', 'prüfungsnahe Bedingungen'],
  },
  {
    icon: Sparkles,
    title: 'KI-Prüfungscoach',
    points: ['erklärt Denkfehler', 'gibt gezielte Hinweise', 'Dozenten-Perspektive'],
  },
  {
    icon: BarChart3,
    title: 'Prüfungsreife-Score',
    points: ['Kompetenz pro Thema', 'klare Schwächenanalyse', 'messbare Fortschritte'],
  },
];

const faqs = [
  {
    q: 'Ist ExamFit ein Ersatz für die Vorlesung?',
    a: 'Nein. ExamFit ersetzt keine Lehre. Es ergänzt sie dort, wo Studierende in Prüfungen scheitern: bei Anwendung, Analyse und Transfer.',
  },
  {
    q: 'Für welche Studiengänge ist das geeignet?',
    a: 'Besonders stark ist ExamFit für klausurorientierte Module in BWL, wirtschaftsnahen Studiengängen und verwandten Fachbereichen.',
  },
  {
    q: 'Was genau trainiere ich – und was nicht?',
    a: 'Du trainierst Prüfungsdenken: Fallanalysen, Transferaufgaben, Modellvergleiche und Entscheidungsfragen. Du lernst NICHT „alles" – du lernst genau das, was in der Klausur entscheidet.',
  },
  {
    q: 'Wie schnell sehe ich, wo ich stehe?',
    a: 'Schon nach den ersten Trainingseinheiten bekommst du eine belastbare Diagnose deiner Stärken, Schwächen und Prüfungsreife.',
  },
];

/* ── helpers ── */

function SectionHeader({
  eyebrow,
  title,
  text,
  dark,
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  dark?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </p>
      )}
      <h2
        className={`text-3xl font-bold tracking-tight sm:text-4xl ${dark ? 'text-primary-foreground' : 'text-foreground'}`}
      >
        {title}
      </h2>
      {text && (
        <p
          className={`mt-4 text-base leading-7 sm:text-lg ${dark ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
        >
          {text}
        </p>
      )}
    </div>
  );
}

/* ── page ── */

export default function PruefungstrainingStudiumPage() {
  return (
    <>
      <SEOHead
        title={seoTitle('Klausuren bestehen: Prüfungstraining für Studierende 2026')}
        description="Du scheiterst nicht am Wissen – du scheiterst an der Prüfung. Trainiere Fallanalysen, Transferaufgaben & Prüfungslogik statt Theorie. Klausurtraining mit messbarer Prüfungsreife – jetzt starten!"
        canonical={`${SITE_URL}/pruefungstraining-studium`}
        structuredData={{
          '@type': 'Course',
          name: 'ExamFit Klausurtraining für Studierende',
          description:
            'Gezieltes Klausurtraining mit Fallanalysen, Transferaufgaben und Prüfungsreife-Diagnose. Nicht Wissen lernen – Bestehen trainieren.',
          provider: { '@type': 'Organization', name: 'ExamFit', sameAs: SITE_URL },
        }}
      />

      <div className="min-h-screen bg-background text-foreground">
        {/* ── HERO ── */}
        <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-muted via-background to-background">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.12),transparent_28%),radial-gradient(circle_at_top_left,hsl(var(--accent)/0.08),transparent_24%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2 lg:px-8 lg:py-28">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col justify-center"
            >
              <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                <GraduationCap className="h-4 w-4" />
                Klausurtraining, nicht Wissensvermittlung
              </div>

              <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Du lernst nicht mehr.{' '}
                <span className="text-gradient">Du trainierst, zu bestehen.</span>
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Studierende scheitern selten am Wissen — sondern an Transferaufgaben,
                Fallanalysen und Prüfungslogik. ExamFit trainiert genau das, was in deiner
                Modulprüfung zählt.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/preise">
                  <Button
                    size="lg"
                    className="h-12 rounded-2xl px-6 text-base font-semibold gradient-primary text-primary-foreground shadow-glow"
                    {...ctaProps('studium_hero_primary', 'Jetzt Prüfungstraining starten')}
                  >
                    Jetzt Prüfungstraining starten
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/pruefungsreife-check">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 rounded-2xl px-6 text-base font-semibold"
                    {...ctaProps('studium_hero_secondary', 'Prüfungsreife kostenlos testen')}
                  >
                    Prüfungsreife kostenlos testen
                  </Button>
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {trustBadges.map((badge) => (
                  <div
                    key={badge}
                    className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm"
                  >
                    {badge}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Hero Card – Core Positioning */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="flex items-center"
            >
              <Card className="w-full rounded-[2rem] shadow-xl">
                <CardContent className="p-6 sm:p-8">
                  <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5 mb-4">
                    <p className="text-sm font-semibold uppercase tracking-wide text-destructive">
                      Das eigentliche Problem
                    </p>
                    <p className="mt-3 text-xl font-bold text-foreground">
                      Du scheiterst nicht am Wissen.
                    </p>
                    <p className="mt-1 text-xl font-bold text-gradient">
                      Du scheiterst an der Prüfung.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      Nicht „Was ist Marketing?" — sondern „Ein Unternehmen verliert Marktanteile.
                      Welche Strategie ist sinnvoll — und warum?" Das ist Prüfung. Und genau das
                      trainiert ExamFit.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-muted p-4">
                      <p className="text-xs font-medium text-muted-foreground">Prüfungsreife</p>
                      <p className="mt-1 text-3xl font-bold text-foreground">78%</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Messbar ab der ersten Session.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-primary/10 p-4">
                      <p className="text-xs font-medium text-primary">Größte Lücke</p>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        Transfer & Fallanalyse
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Genau dort, wo die meisten Punkte verloren gehen.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ── CORE DIFFERENZIERUNG ── */}
        <section className="bg-foreground text-background">
          <div className="mx-auto max-w-4xl px-6 py-16 text-center lg:px-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              Die entscheidende Unterscheidung
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Die Uni bringt dir den Stoff bei.<br />
              Wir bringen dich durch die Prüfung.
            </h2>
            <p className="mt-5 text-lg leading-8 text-background/70">
              ExamFit ist kein Lernsystem für Inhalte. Es ist ein Trainingssystem für Prüfungen.
              Der Unterschied ist nicht Wissen — der Unterschied ist Bestehen.
            </p>
          </div>
        </section>

        {/* ── PROBLEM ── */}
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <SectionHeader
            eyebrow="Das Problem"
            title="Du lernst viel – aber die Prüfung fragt anders"
            text="Das Problem ist nicht dein Einsatz. Das Problem ist, dass niemand dich auf die Prüfung vorbereitet – nur auf den Stoff."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {painPoints.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="rounded-3xl shadow-sm">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex rounded-2xl bg-destructive/10 p-3 text-destructive">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── VERGLEICH: Uni vs ExamFit ── */}
        <section className="bg-muted/50 py-20">
          <div className="mx-auto max-w-4xl px-6 lg:px-8">
            <SectionHeader
              eyebrow="Vergleich"
              title="Uni-Lernen vs. ExamFit-Training"
              text="Andere Plattformen geben dir mehr Content. Wir geben dir Prüfungsdenken."
            />
            <div className="mt-12 overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
              <div className="grid grid-cols-2 border-b border-border bg-muted/30">
                <div className="px-6 py-4 text-sm font-semibold text-muted-foreground">
                  Klassisches Lernen
                </div>
                <div className="px-6 py-4 text-sm font-semibold text-primary">
                  ExamFit
                </div>
              </div>
              {compareRows.map(([left, right]) => (
                <div
                  key={left}
                  className="grid grid-cols-2 border-b border-border last:border-b-0"
                >
                  <div className="px-6 py-4 text-sm leading-6 text-muted-foreground">{left}</div>
                  <div className="px-6 py-4 text-sm font-medium leading-6 text-foreground">
                    {right}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── LÖSUNG ── */}
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <SectionHeader
            eyebrow="So funktioniert's"
            title="Vier Schritte von Wissen zu Prüfungsreife"
            text="ExamFit macht aus deinem Wissen echte Prüfungsfähigkeit – messbar, gezielt, unter realen Bedingungen."
          />
          <div className="mt-14 grid gap-6 lg:grid-cols-4">
            {steps.map((step, idx) => (
              <Card key={step.title} className="rounded-3xl bg-card shadow-sm">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
                    {idx + 1}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── FEATURES (dark) ── */}
        <section className="bg-primary py-20 text-primary-foreground">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <SectionHeader
              eyebrow="Features"
              title="Alles für deine Modulprüfung – in einem System"
              text="Nicht als Ersatz für die Vorlesung, sondern als Trainingslayer für Klausur, Fallanalyse und Transfer."
              dark
            />
            <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {features.map(({ icon: Icon, title, points }) => (
                <Card
                  key={title}
                  className="rounded-3xl border-primary-foreground/10 bg-primary-foreground/5 text-primary-foreground shadow-none backdrop-blur"
                >
                  <CardContent className="p-6">
                    <div className="mb-4 inline-flex rounded-2xl bg-primary-foreground/10 p-3 text-accent">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <div className="mt-4 space-y-3">
                      {points.map((point) => (
                        <div
                          key={point}
                          className="flex items-start gap-2 text-sm text-primary-foreground/80"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          <span>{point}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── RISIKO-ANKER ── */}
        <section className="mx-auto max-w-4xl px-6 py-20 lg:px-8">
          <Card className="rounded-[2rem] border-destructive/20 bg-destructive/5 shadow-sm">
            <CardContent className="p-8 sm:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-destructive">
                    Was kostet es, wenn du durchfällst?
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { label: 'Prüfungsversuch verloren', detail: 'Im schlimmsten Fall: Exmatrikulation' },
                  { label: 'Monate an zusätzlicher Zeit', detail: 'Nächste Chance erst im Folgesemester' },
                  { label: 'Stress & Motivationsverlust', detail: 'Der Druck steigt mit jedem Versuch' },
                  { label: 'Reale Kosten: 500 € – 5.000 €+', detail: 'Semesterbeiträge, verlorene Praktika, Verzögerung' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-border bg-background/80 p-4">
                    <p className="font-semibold text-foreground">{item.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl bg-foreground px-5 py-4 text-background text-center">
                <p className="text-sm font-semibold">ExamFit kostet einmalig 59 €</p>
                <p className="mt-1 text-lg font-bold">Weniger als falsches Lernen über Wochen.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── SEGMENTIERTER CTA-BLOCK ── */}
        <section className="bg-muted/50 py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <SectionHeader
              eyebrow="Dein Weg"
              title="Wähle den passenden Einstieg"
              text="Egal ob du selbst zahlst, über dein Unternehmen läufst oder eine Hochschule vertrittst."
            />
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {/* Studierende – Self-Pay */}
              <Card className="rounded-3xl shadow-sm hover:shadow-lg transition-shadow">
                <CardContent className="p-8 flex flex-col h-full">
                  <div className="mb-4 inline-flex rounded-2xl bg-primary/10 p-3 text-primary w-fit">
                    <GraduationCap className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Für Studierende</h3>
                  <p className="text-sm leading-6 text-muted-foreground mb-6 flex-1">
                    Du zahlst selbst und trainierst sofort. Einzelzugang ab 59 € – kein Abo, keine
                    Kündigung.
                  </p>
                  <div className="space-y-3">
                    <Link to="/preise">
                      <Button
                        className="w-full rounded-xl gradient-primary text-primary-foreground shadow-glow"
                        size="lg"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'studium_segment_student_buy',
                            label: 'Jetzt Zugang sichern',
                          })
                        }
                      >
                        Jetzt Zugang sichern
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                    <Link to="/pruefungsreife-check">
                      <Button
                        variant="ghost"
                        className="w-full rounded-xl text-sm"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'cta_readiness_check_studium',
                            label: 'Erst kostenlos testen',
                          })
                        }
                      >
                        Erst kostenlos testen
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              {/* Dual / Betriebe */}
              <Card className="rounded-3xl shadow-sm hover:shadow-lg transition-shadow ring-2 ring-primary">
                <CardContent className="p-8 flex flex-col h-full relative">
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs">
                    Häufigster Pfad
                  </Badge>
                  <div className="mb-4 inline-flex rounded-2xl bg-accent/10 p-3 text-accent w-fit">
                    <Users className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">
                    Für Unternehmen & duales Studium
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground mb-6 flex-1">
                    Team-Lizenzen für dual Studierende und Mitarbeitende. Ab 5 Plätzen, zentrale
                    Verwaltung.
                  </p>
                  <div className="space-y-3">
                    <Link to="/preise">
                      <Button
                        className="w-full rounded-xl"
                        size="lg"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'cta_dual_company',
                            label: 'Team-Lizenz anfragen',
                          })
                        }
                      >
                        Team-Lizenz anfragen
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                    <Link to="/pruefungstraining-betriebe">
                      <Button
                        variant="ghost"
                        className="w-full rounded-xl text-sm"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'studium_segment_b2b_info',
                            label: 'Mehr für Unternehmen',
                          })
                        }
                      >
                        Mehr für Unternehmen erfahren
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              {/* Hochschulen */}
              <Card className="rounded-3xl shadow-sm hover:shadow-lg transition-shadow">
                <CardContent className="p-8 flex flex-col h-full">
                  <div className="mb-4 inline-flex rounded-2xl bg-success/10 p-3 text-success w-fit">
                    <Building className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Für Hochschulen</h3>
                  <p className="text-sm leading-6 text-muted-foreground mb-6 flex-1">
                    Kooperationsmodelle, Pilotprojekte und Campus-Lizenzen für wirtschaftsnahe
                    Studiengänge.
                  </p>
                  <div className="space-y-3">
                    <Link to="/pruefungstraining-institutionen">
                      <Button
                        variant="outline"
                        className="w-full rounded-xl"
                        size="lg"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'cta_university_demo',
                            label: 'Demo & Kooperation',
                          })
                        }
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Demo & Kooperation
                      </Button>
                    </Link>
                    <Link to="/pruefungstraining-institutionen">
                      <Button
                        variant="ghost"
                        className="w-full rounded-xl text-sm"
                        onClick={() =>
                          trackConversion({
                            event: 'cta_click',
                            source: 'studium_segment_uni_info',
                            label: 'Mehr für Hochschulen',
                          })
                        }
                      >
                        Mehr für Hochschulen erfahren
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="mx-auto max-w-5xl px-6 py-20 lg:px-8">
          <SectionHeader eyebrow="FAQ" title="Häufige Fragen" />
          <div className="mt-12 space-y-4">
            {faqs.map((faq) => (
              <Card key={faq.q} className="rounded-3xl shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-foreground">{faq.q}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── CTA FINALE ── */}
        <section className="border-t border-border bg-background">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="rounded-[2rem] bg-primary px-8 py-12 text-primary-foreground sm:px-12">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  Jetzt starten
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Die Frage ist nicht „Ist das teuer?"
                </h2>
                <p className="mt-2 text-2xl font-bold">
                  Sondern: Was kostet es dich, wenn du es NICHT nutzt?
                </p>
                <p className="mt-4 text-base leading-7 text-primary-foreground/70 sm:text-lg">
                  Du lernst nicht mehr. Du trainierst, zu bestehen. Mit messbarer Prüfungsreife,
                  echtem Transfertraining und einem System, das dir zeigt, wann du bereit bist.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link to="/preise">
                    <Button
                      size="lg"
                      variant="secondary"
                      className="h-12 rounded-2xl px-6 text-base font-semibold"
                      {...ctaProps('studium_bottom_primary', 'Jetzt Prüfungstraining starten')}
                    >
                      Jetzt Prüfungstraining starten
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/pruefungsreife-check">
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-12 rounded-2xl border-primary-foreground/20 bg-transparent px-6 text-base font-semibold text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                      {...ctaProps('studium_bottom_secondary', 'Prüfungsreife kostenlos testen')}
                    >
                      Prüfungsreife kostenlos testen
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
