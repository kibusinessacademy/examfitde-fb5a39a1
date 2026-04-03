import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle } from '@/lib/seo';
import { ctaProps } from '@/lib/seo-tracking';
import {
  Target,
  CheckCircle,
  ArrowRight,
  Brain,
  TrendingUp,
  BookOpen,
  Clock,
  BarChart3,
  RefreshCw,
  GraduationCap,
  AlertTriangle,
  Lightbulb,
  MessageSquareQuote,
  Zap,
} from 'lucide-react';

const faqItems = [
  {
    q: 'Ist das ein Ersatz für die Vorlesung?',
    a: 'Nein. ExamFit ersetzt keine Vorlesung – es ist dein Prüfungstraining. Du trainierst gezielt, was in der Klausur abgefragt wird.',
  },
  {
    q: 'Für welche Studiengänge ist ExamFit geeignet?',
    a: 'Für alle Studiengänge mit klausurbasierten Modulprüfungen – z.\u00A0B. BWL, VWL, Wirtschaftswissenschaften, Wirtschaftsingenieurwesen und weitere.',
  },
  {
    q: 'Wie schnell sehe ich Ergebnisse?',
    a: 'Schon nach den ersten Trainingsdurchläufen erkennst du deine Schwächen und verbesserst deine Prüfungsreife messbar.',
  },
];

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
          description: 'Gezieltes Klausurtraining mit Fallanalysen, Transferaufgaben und Prüfungsreife-Diagnose.',
          provider: {
            '@type': 'Organization',
            name: 'ExamFit',
            sameAs: SITE_URL,
          },
        }}
      />

      <div className="min-h-screen">
        {/* ── HERO ── */}
        <section className="py-20 px-4 relative overflow-hidden">
          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 mb-6 animate-fade-in">
              <GraduationCap className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Für Studierende entwickelt</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-6 animate-fade-in">
              Bestehe deine Klausuren.{' '}
              <span className="text-gradient text-glow">Nicht irgendwann – sondern planbar.</span>
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Trainiere genau das, was in deiner Modulprüfung zählt – mit Fallanalysen, Transferaufgaben
              und einem System, das dir zeigt, ob du wirklich bereit bist.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg"
                  {...ctaProps('studium_hero_primary', 'Jetzt Prüfungstraining starten')}
                >
                  Jetzt Prüfungstraining starten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/pruefungsreife-check">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50"
                  {...ctaProps('studium_hero_secondary', 'Prüfungsreife kostenlos testen')}
                >
                  Prüfungsreife kostenlos testen
                </Button>
              </Link>
            </div>

            {/* Trust Bar */}
            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <span>Basierend auf Modulplänen</span>
              </div>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <span>Keine Theorieflut – nur Prüfungsrelevanz</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span>Sofort einsetzbar</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROBLEM (Pain Trigger) ── */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl text-center">
            <AlertTriangle className="h-10 w-10 text-warning mx-auto mb-4" />
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-8">
              Du lernst viel – aber weißt nicht, <span className="text-gradient">ob es reicht?</span>
            </h2>
            <div className="space-y-4 text-lg text-muted-foreground text-left max-w-xl mx-auto">
              <p>❌ Du verstehst die Vorlesung – aber kannst es nicht anwenden.</p>
              <p>❌ Du lernst stundenlang – aber fühlst dich unsicher.</p>
              <p>❌ Du weißt nicht, wie Klausuren wirklich bewertet werden.</p>
            </div>
            <div className="mt-8 p-6 rounded-2xl border border-primary/20 bg-primary/5">
              <p className="text-lg font-semibold">
                👉 Das Problem ist nicht dein Lernen.<br />
                👉 Das Problem ist <span className="text-primary">fehlendes Prüfungstraining.</span>
              </p>
            </div>
          </div>
        </section>

        {/* ── LÖSUNG (Positionierung) ── */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <Lightbulb className="h-10 w-10 text-primary mx-auto mb-4" />
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              ExamFit macht aus Wissen <span className="text-gradient">echte Prüfungsfähigkeit</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              ExamFit ist kein klassischer Lernkurs. Es ist ein Prüfungstrainings-System,
              das dich gezielt auf deine Klausur vorbereitet.
            </p>
          </div>
        </section>

        {/* ── SO FUNKTIONIERT'S ── */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              So wirst du <span className="text-gradient">prüfungsreif</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { step: '1', icon: Target, label: 'Prüfung starten oder simulieren', desc: 'Du arbeitest mit klausurähnlichen Aufgaben.' },
                { step: '2', icon: BarChart3, label: 'Analyse deiner Antworten', desc: 'Das System erkennt deine Schwächen.' },
                { step: '3', icon: RefreshCw, label: 'Gezielte Verbesserung', desc: 'Erklärungen + Transfertraining.' },
                { step: '4', icon: CheckCircle, label: 'Prüfungsreife messen', desc: 'Du weißt, wann du bereit bist.' },
              ].map(({ step, icon: Icon, label, desc }) => (
                <div key={step} className="glass-card rounded-2xl p-6 text-center">
                  <div className="w-12 h-12 rounded-full gradient-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 font-bold text-lg">
                    {step}
                  </div>
                  <Icon className="h-6 w-6 text-primary mx-auto mb-2" />
                  <h3 className="font-semibold mb-1">{label}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── USP-BLOCK ── */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Warum Studierende mit ExamFit <span className="text-gradient">sicher bestehen</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {[
                { icon: Target, title: '🎯 Prüfungslogik statt Lernchaos', text: 'Du trainierst genau das, was bewertet wird – nicht alles.' },
                { icon: BarChart3, title: '📊 Prüfungsreife sichtbar machen', text: 'Kein „Ich glaube, ich kanns" – sondern: Du weißt es.' },
                { icon: RefreshCw, title: '🔁 Transfer statt Auswendiglernen', text: 'Du lernst nicht nur Inhalte – du lernst, sie anzuwenden.' },
                { icon: Brain, title: '🧠 Denken wie im Studium', text: 'Analyse, Bewertung, Transfer – genau das, was in Klausuren verlangt wird.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 flex gap-4 items-start">
                  <Icon className="h-8 w-8 text-primary shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Alles, was du brauchst – <span className="text-gradient">in einem System</span>
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: BookOpen, title: 'Prüfungstrainer', items: ['Fallanalysen', 'Transferaufgaben', 'Modellvergleiche'] },
                { icon: Clock, title: 'Klausursimulation', items: ['Zeitdruck', 'Echte Struktur', 'Realistische Bewertung'] },
                { icon: Brain, title: 'KI-Tutor', items: ['Erklärt komplexe Themen', 'Zeigt Denkfehler', 'Gezielte Hinweise'] },
                { icon: TrendingUp, title: 'Fortschritt & Diagnose', items: ['Kompetenz-Level pro Thema', 'Schwächenanalyse', 'Lernempfehlungen'] },
              ].map(({ icon: Icon, title, items }) => (
                <div key={title} className="glass-card rounded-2xl p-6">
                  <Icon className="h-8 w-8 text-primary mb-3" />
                  <h3 className="font-semibold mb-3">{title}</h3>
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DIFFERENZIERUNG ── */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Das ist kein Uni-Kurs. <span className="text-gradient">Und keine Lern-App.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
              ExamFit ersetzt keine Vorlesung. Es ergänzt sie – genau da, wo Studierende scheitern:
            </p>
            <p className="text-2xl font-display font-bold text-primary">👉 bei der Prüfung.</p>
          </div>
        </section>

        {/* ── FÜR WEN ── */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl text-center">
            <GraduationCap className="h-10 w-10 text-primary mx-auto mb-4" />
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-8">
              Für wen ist <span className="text-gradient">ExamFit?</span>
            </h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                'Studierende kurz vor Klausuren',
                'Studierende mit Verständnisproblemen',
                'Studierende, die sicher bestehen wollen',
              ].map((text) => (
                <div key={text} className="glass-card rounded-2xl p-6 flex flex-col items-center gap-3">
                  <CheckCircle className="h-6 w-6 text-primary" />
                  <p className="font-medium text-sm">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SOCIAL PROOF ── */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Was Studierende <span className="text-gradient">sagen</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {[
                { quote: 'Ich habe endlich verstanden, wie ich Aufgaben lösen muss – nicht nur den Stoff.', author: 'BWL Studentin' },
                { quote: 'Vor der Klausur wusste ich genau, wo ich stehe.', author: 'Wirtschaftsstudent' },
              ].map(({ quote, author }) => (
                <div key={author} className="glass-card rounded-2xl p-8">
                  <MessageSquareQuote className="h-8 w-8 text-primary/40 mb-4" />
                  <blockquote className="text-lg italic mb-4">„{quote}"</blockquote>
                  <p className="text-sm text-muted-foreground">— {author}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA BLOCK ── */}
        <section className="py-20 px-4 bg-muted/30">
          <div className="container mx-auto max-w-3xl text-center">
            <div className="glass-card rounded-2xl p-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                Starte jetzt dein <span className="text-gradient">Prüfungstraining</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Keine Theorieflut. Kein Rätselraten.<br />
                Nur gezielte Vorbereitung auf deine Klausur.
              </p>
              <Link to="/shop">
                <Button
                  size="lg"
                  className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg"
                  {...ctaProps('studium_bottom_cta', 'Jetzt starten')}
                >
                  Jetzt starten
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="py-16 px-4">
          <div className="container mx-auto max-w-3xl">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-center mb-12">
              Häufig gestellte <span className="text-gradient">Fragen</span>
            </h2>
            <div className="space-y-6">
              {faqItems.map(({ q, a }) => (
                <details key={q} className="glass-card rounded-2xl p-6 group cursor-pointer">
                  <summary className="font-semibold list-none flex items-center justify-between">
                    {q}
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-3 text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── POSITIONIERUNG CLOSER ── */}
        <section className="py-12 px-4">
          <div className="container mx-auto max-w-3xl text-center">
            <p className="text-lg text-muted-foreground italic">
              „ExamFit ist das erste System, das Studierende nicht zum Lernen bringt – sondern zum Bestehen."
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
