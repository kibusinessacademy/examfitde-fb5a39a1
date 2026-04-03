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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle } from '@/lib/seo';
import { ctaProps } from '@/lib/seo-tracking';

/* ── data ── */

const trustBadges = [
  'Basierend auf Modulplänen',
  'Keine Theorieflut – nur Prüfungsrelevanz',
  'Sofort einsetzbar',
];

const painPoints = [
  'Du verstehst die Vorlesung – aber kannst es in der Klausur nicht sauber anwenden.',
  'Du lernst stundenlang – aber weißt nicht, ob es wirklich reicht.',
  'Du kennst den Stoff – aber nicht die Denkmuster, die in Modulprüfungen bewertet werden.',
];

const steps = [
  {
    title: 'Prüfung starten oder simulieren',
    text: 'Du trainierst mit klausurähnlichen Aufgaben, Transferfragen und Fallanalysen statt mit bloßer Theorie-Wiederholung.',
  },
  {
    title: 'Antworten analysieren',
    text: 'Das System erkennt, wo dir Wissen, Anwendung, Analyse oder Transfer noch fehlen.',
  },
  {
    title: 'Gezielt verbessern',
    text: 'Du bekommst Erklärungen, Denkfehler-Hinweise und Übungen genau dort, wo deine Prüfungsschwächen liegen.',
  },
  {
    title: 'Prüfungsreife messen',
    text: 'Du siehst klar, wann du bereit bist – statt dich auf Bauchgefühl zu verlassen.',
  },
];

const uspCards = [
  {
    icon: Target,
    title: 'Prüfungslogik statt Lernchaos',
    text: 'Du trainierst genau das, was in der Modulprüfung bewertet wird – nicht alles irgendwie ein bisschen.',
  },
  {
    icon: BarChart3,
    title: 'Prüfungsreife sichtbar machen',
    text: 'Kein „Ich glaube, ich kanns" mehr. Du siehst deine Stärken, Lücken und den nächsten sinnvollen Schritt.',
  },
  {
    icon: Brain,
    title: 'Transfer statt Auswendiglernen',
    text: 'Du lernst nicht nur Inhalte, sondern wie du Modelle, Konzepte und Methoden in neuen Kontexten anwendest.',
  },
  {
    icon: GraduationCap,
    title: 'Denken wie in der Klausur',
    text: 'Analyse, Bewertung und Transfer – genau die Denkformen, an denen viele Studierende in Prüfungen scheitern.',
  },
];

const features = [
  {
    icon: FileText,
    title: 'Prüfungstrainer',
    points: ['Fallanalysen', 'Transferaufgaben', 'Modellvergleiche'],
  },
  {
    icon: Clock3,
    title: 'Klausursimulation',
    points: ['Zeitdruck', 'realistische Struktur', 'prüfungsnahes Training'],
  },
  {
    icon: Sparkles,
    title: 'KI-Tutor im Dozentenmodus',
    points: ['erklärt komplexe Themen', 'zeigt Denkfehler', 'gibt gezielte Hinweise'],
  },
  {
    icon: CheckCircle2,
    title: 'Fortschritt & Diagnose',
    points: ['Kompetenz-Level pro Thema', 'klare Schwächenanalyse', 'Lernempfehlungen'],
  },
];

const audience = [
  'Studierende kurz vor Klausuren',
  'Studierende mit Verständnis- oder Transferproblemen',
  'Studierende, die sicherer und strukturierter bestehen wollen',
];

const faqs = [
  {
    q: 'Ist das ein Ersatz für die Vorlesung?',
    a: 'Nein. ExamFit ersetzt keine Lehre. Es ergänzt sie dort, wo Studierende in Prüfungen scheitern: bei Anwendung, Analyse und Transfer.',
  },
  {
    q: 'Für welche Studiengänge ist das geeignet?',
    a: 'Besonders stark ist ExamFit für klausurorientierte Studiengänge und Module, etwa BWL, wirtschaftsnahe Studiengänge und verwandte Fachbereiche.',
  },
  {
    q: 'Wie schnell sehe ich, wo ich stehe?',
    a: 'Schon nach den ersten Trainingsdurchläufen bekommst du eine belastbare Diagnose deiner Stärken, Schwächen und Prüfungsreife.',
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
        title={seoTitle('Klausuren bestehen: Prüfungstraining für Studierende')}
        description="Klausur-Vorbereitung mit System: Fallanalysen, Transferaufgaben & Prüfungsreife-Check für dein Studium. Trainiere gezielt, was in der Modulprüfung zählt – jetzt starten!"
        canonical={`${SITE_URL}/pruefungstraining-studium`}
        structuredData={{
          '@type': 'Course',
          name: 'ExamFit Prüfungstraining für Studierende',
          description:
            'Gezieltes Klausurtraining mit Fallanalysen, Transferaufgaben und Prüfungsreife-Diagnose.',
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
                Prüfungstraining für Studierende
              </div>

              <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Bestehe deine Klausuren. Nicht irgendwann – sondern planbar.
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Trainiere genau das, was in deiner Modulprüfung zählt – mit Fallanalysen,
                Transferaufgaben und einem System, das dir zeigt, ob du wirklich bereit bist.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/shop">
                  <Button
                    size="lg"
                    className="h-12 rounded-2xl px-6 text-base font-semibold"
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

            {/* Hero Card */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="flex items-center"
            >
              <Card className="w-full rounded-[2rem] shadow-xl">
                <CardContent className="p-6 sm:p-8">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-muted p-5">
                      <p className="text-sm font-medium text-muted-foreground">Prüfungsreife</p>
                      <p className="mt-2 text-4xl font-bold text-foreground">78%</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Du weißt vor der Klausur, wo du wirklich stehst.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-primary/10 p-5">
                      <p className="text-sm font-medium text-primary">Größte Lücke</p>
                      <p className="mt-2 text-xl font-bold text-foreground">
                        Transfer &amp; Fallanalyse
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Nicht nur Wissen, sondern Anwendung unter Prüfungsbedingungen.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border p-5 sm:col-span-2">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 text-success" />
                        <div>
                          <p className="font-semibold text-foreground">
                            ExamFit ist kein Uni-Kurs. Und keine Lern-App.
                          </p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            ExamFit ergänzt deine Lehre genau dort, wo Studierende scheitern: bei
                            Prüfungssituationen, Transferaufgaben, Fallanalysen und echter
                            Selbsteinschätzung.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </section>

        {/* ── PROBLEM ── */}
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <SectionHeader
            eyebrow="Problem"
            title="Du lernst viel – aber weißt nicht, ob es reicht?"
            text="Das Problem ist oft nicht dein Einsatz. Das Problem ist fehlendes Prüfungstraining mit klarem Fokus auf Anwendung, Analyse und Transfer."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {painPoints.map((point) => (
              <Card key={point} className="rounded-3xl shadow-sm">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex rounded-2xl bg-warning/10 p-3 text-warning">
                    <Lightbulb className="h-5 w-5" />
                  </div>
                  <p className="text-base leading-7 text-muted-foreground">{point}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── LÖSUNG ── */}
        <section className="bg-muted/50 py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <SectionHeader
              eyebrow="Lösung"
              title="ExamFit macht aus Wissen echte Prüfungsfähigkeit"
              text="ExamFit ist kein klassischer Lernkurs, sondern ein Prüfungstrainings-System für Studierende, die nicht nur lernen, sondern sicherer bestehen wollen."
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
          </div>
        </section>

        {/* ── USP ── */}
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <SectionHeader
            eyebrow="USP"
            title="Warum Studierende und Hochschulen ExamFit ernst nehmen"
            text="Nicht mehr Content ist der Unterschied – sondern messbare Prüfungsreife, echte Transferleistung und strukturierte Prüfungsvorbereitung."
          />
          <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {uspCards.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="rounded-3xl shadow-sm">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex rounded-2xl bg-primary/10 p-3 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
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
              title="Alles, was du für deine Modulprüfung brauchst – in einem System"
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

        {/* ── DIFFERENZIERUNG + ZIELGRUPPE ── */}
        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
                Abgrenzung
              </p>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Das ist kein Uni-Kurs. Und keine Lern-App.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                ExamFit ersetzt keine Lehre. Es ergänzt sie – genau dort, wo Studierende scheitern:
                bei Prüfungssituationen, Transferaufgaben, Denkfehlern und fehlender
                Selbsteinschätzung.
              </p>
              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Für Hochschulen liegt der Mehrwert in standardisierter Prüfungsvorbereitung,
                transparenteren Kompetenzständen und einer Entlastung bei wiederkehrenden
                Prüfungsfragen.
              </p>
            </div>
            <Card className="rounded-[2rem] shadow-lg">
              <CardContent className="p-8">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Für wen?
                </p>
                <div className="mt-6 space-y-4">
                  {audience.map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-2xl bg-muted p-4">
                      <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="bg-muted/50 py-20">
          <div className="mx-auto max-w-5xl px-6 lg:px-8">
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
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="border-t border-border bg-background">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="rounded-[2rem] bg-primary px-8 py-12 text-primary-foreground sm:px-12">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  Jetzt starten
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Starte jetzt dein Prüfungstraining
                </h2>
                <p className="mt-4 text-base leading-7 text-primary-foreground/70 sm:text-lg">
                  Keine Theorieflut. Kein Rätselraten. Nur gezielte Vorbereitung auf deine nächste
                  Klausur – mit messbarer Prüfungsreife und echtem Transfertraining.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link to="/shop">
                    <Button
                      size="lg"
                      variant="secondary"
                      className="h-12 rounded-2xl px-6 text-base font-semibold"
                      {...ctaProps('studium_bottom_primary', 'Jetzt starten')}
                    >
                      Jetzt starten
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
