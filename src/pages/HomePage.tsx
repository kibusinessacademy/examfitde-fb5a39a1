import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useState } from 'react';
import { SEOHead } from '@/components/seo/SEOHead';
import { generateFAQSchema, generateCourseListSchema, SITE_URL } from '@/lib/seo';
import { Testimonials } from '@/components/marketing/Testimonials';
import { StickyCTA } from '@/components/marketing/StickyCTA';
import {
  ArrowRight,
  CheckCircle,
  Shield,
  Clock,
  Brain,
  Mic,
  TrendingUp,
  Star,
  Target,
  Users,
  GraduationCap,
  Building2,
  BookOpen,
  Sparkles,
  Zap,
  ClipboardCheck,
} from 'lucide-react';

function AnimatedCounter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const duration = 1500;
    const steps = 40;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [target]);
  return <>{count.toLocaleString('de-DE')}{suffix}</>;
}

export default function HomePage() {
  const { user } = useAuth();

  return (
    <>
      <SEOHead
        title="IHK-Prüfung bestehen – Prüfungstraining für Azubis | ExamFit"
        description="Bereite dich optimal auf deine IHK-Prüfung vor. Prüfungssimulation, KI-Prüfungscoach & mündliche Prüfung trainieren. 98 % Bestehensquote. Einmalig 39 €."
        canonical={`${SITE_URL}/`}
        type="website"
        structuredData={[
          generateFAQSchema([
            { question: 'Was kostet ExamFit?', answer: 'ExamFit kostet einmalig 39 € für 12 Monate Zugang. Kein Abo, keine versteckten Kosten.' },
            { question: 'Für welche IHK-Prüfungen gibt es Prüfungstraining?', answer: 'ExamFit bietet Prüfungstraining für über 50 IHK-Ausbildungsberufe, darunter Kaufleute für Büromanagement, Industriekaufleute, Fachinformatiker und viele mehr.' },
            { question: 'Wie hoch ist die Bestehensquote?', answer: '98 % unserer Nutzer bestehen ihre IHK-Prüfung beim ersten Versuch.' },
            { question: 'Gibt es eine mündliche Prüfungssimulation?', answer: 'Ja, ExamFit bietet eine KI-gestützte mündliche Prüfungssimulation mit Echtzeit-Feedback zu deinen Antworten.' },
          ]),
          generateCourseListSchema([
            { name: 'IHK-Prüfungstraining', url: `${SITE_URL}/shop`, description: 'Komplett-Prüfungstraining für über 50 IHK-Ausbildungsberufe', price: 39 },
          ]),
        ]}
      />
      <div className="min-h-screen">
        {/* Hero Section – kompakter, Preis sichtbar */}
        <section className="py-12 sm:py-16 md:py-24 px-3 sm:px-4 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

          <div className="container mx-auto text-center max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Star className="h-4 w-4 text-warning fill-warning" />
              <span className="text-sm text-muted-foreground">98 % Bestehensquote · 5.000+ Absolventen</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-5 animate-fade-in leading-[1.1]">
              IHK-Prüfung{' '}
              <span className="text-gradient text-glow">sicher bestehen</span>
            </h1>

            <p className="text-base sm:text-xl text-muted-foreground mb-6 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Trainiere exakt das, was geprüft wird – mit echten Prüfungsaufgaben, Simulationen und KI-Prüfungscoach.
            </p>

            {/* Preis direkt im Hero sichtbar */}
            <div className="inline-flex items-baseline gap-2 mb-6 animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <span className="text-2xl sm:text-3xl font-display font-bold text-gradient">39 €</span>
              <span className="text-sm text-muted-foreground">einmalig · 12 Monate · Kein Abo</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg transition-all rounded-xl h-14 px-8 text-lg group">
                  Prüfungstraining starten
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/pruefungsreife-check">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50 group">
                  <ClipboardCheck className="h-5 w-5 mr-2" />
                  Kostenloser Prüfungsreife-Check
                </Button>
              </Link>
            </div>

            {/* Trust Indicators – kompakter */}
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-8 text-xs sm:text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-accent" />
                <span>Einmalzahlung</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-accent" />
                <span>12 Monate Zugang</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-accent" />
                <span>Basierend auf Rahmenplan</span>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-8 sm:py-12 px-3 sm:px-4">
          <div className="container mx-auto max-w-5xl">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {[
                { value: 5000, suffix: '+', label: 'Erfolgreiche Absolventen', gradient: 'text-gradient' },
                { value: 98, suffix: ' %', label: 'Bestehensquote', gradient: 'text-gradient-accent' },
                { value: 500, suffix: '+', label: 'Prüfungsrelevante Aufgaben', gradient: 'text-gradient' },
                { value: 24, suffix: '/7', label: 'Trainieren wann du willst', gradient: 'text-gradient-accent' },
              ].map(({ value, suffix, label, gradient }, i) => (
                <div key={label} className="glass-card rounded-2xl text-center p-4 sm:p-6 animate-fade-in" style={{ animationDelay: `${0.3 + i * 0.08}s` }}>
                  <div className={`text-2xl sm:text-4xl font-display font-bold ${gradient} mb-1 sm:mb-2`}>
                    <AnimatedCounter target={value} suffix={suffix} />
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Problem → Solution */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4 sm:mb-6">
              Bestehe deine Prüfung – <span className="text-gradient">beim ersten Anlauf.</span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
              ExamFit analysiert deine Schwächen, trainiert gezielt prüfungsrelevante Inhalte
              und zeigt dir in Echtzeit, wie nah du am Bestehen bist.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { emoji: '😰', title: 'Das Problem', text: 'Klassische Bücher und Karteikarten bereiten nicht auf echte Prüfungsaufgaben vor.' },
                { emoji: '🧠', title: 'Unsere Lösung', text: 'Adaptive Algorithmen erkennen Schwächen und trainieren gezielt das, was geprüft wird.' },
                { emoji: '🎯', title: 'Dein Ergebnis', text: 'Du gehst prüfungsreif und selbstsicher in die Abschlussprüfung.' },
              ].map(({ emoji, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-6 text-center hover:border-primary/30 transition-colors">
                  <div className="text-4xl mb-4">{emoji}</div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <Testimonials />

        {/* Pricing */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
              Ein Produkt. Ein Ziel. <span className="text-gradient">Bestehen.</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-12">
              ExamFit – Intelligentes Prüfungstraining. Alles, was du für die Abschlussprüfung brauchst, in einem System.
            </p>

            <div className="glass-card rounded-2xl p-5 sm:p-8 md:p-12 border-2 border-primary/30 max-w-2xl mx-auto relative overflow-hidden">
              <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                <Sparkles className="h-3 w-3" />
                Beliebteste Wahl
              </div>

              <div className="flex items-baseline gap-2 justify-center mb-6 mt-4 sm:mt-0">
                <span className="text-4xl sm:text-5xl font-display font-bold text-gradient">39 €</span>
                <span className="text-muted-foreground">einmalig · 12 Monate</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-left mb-8">
                {[
                  'Prüfungssimulation (schriftlich)',
                  'Mündliche Prüfung trainieren',
                  'KI-Prüfungscoach',
                  'Prüfungswissen kompakt',
                  'Adaptive Schwächenanalyse',
                  'Prüfungsreife-Indikator',
                ].map(feature => (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-success flex-shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <Link to="/shop">
                <Button size="lg" className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg group">
                  Jetzt Prüfungstraining starten
                  <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-8 md:mb-16">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
                Das macht ExamFit <span className="text-gradient">besonders</span>
              </h2>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {[
                { icon: Brain, color: 'text-primary', title: 'Adaptives Training', text: 'Das System erkennt deine Schwächen und trainiert gezielt.' },
                { icon: Mic, color: 'text-accent', title: 'Mündliche Prüfung', text: 'Übe das Fachgespräch mit KI-Feedback zu deinen Antworten.' },
                { icon: TrendingUp, color: 'text-success', title: 'Prüfungsreife messen', text: '98 % unserer Nutzer bestehen die Prüfung beim ersten Versuch.' },
                { icon: Target, color: 'text-warning', title: 'Nach Rahmenplan', text: 'Alle Inhalte basieren auf dem offiziellen Ausbildungsrahmenplan.' },
              ].map(({ icon: Icon, color, title, text }) => (
                <div key={title} className="glass-card rounded-2xl p-5 sm:p-6 text-center hover:border-primary/30 transition-colors">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
                    <Icon className={`h-6 w-6 ${color}`} />
                  </div>
                  <h3 className="font-semibold mb-2 text-sm sm:text-base">{title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Prüfungsreife-Check CTA Banner */}
        <section className="py-10 sm:py-14 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl">
            <Link to="/pruefungsreife-check" className="block">
              <div className="glass-card rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 hover:border-accent/40 transition-colors group">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
                  <ClipboardCheck className="h-7 w-7 text-accent" />
                </div>
                <div className="text-center sm:text-left flex-1">
                  <h3 className="text-lg font-display font-bold mb-1">Kostenloser Prüfungsreife-Check</h3>
                  <p className="text-sm text-muted-foreground">
                    Finde in 2 Minuten heraus, wie gut du auf deine IHK-Prüfung vorbereitet bist. Ohne Anmeldung.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all flex-shrink-0" />
              </div>
            </Link>
          </div>
        </section>

        {/* Zielgruppen */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
          <div className="container mx-auto max-w-5xl">
            <div className="text-center mb-8 md:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
                Ein Produkt – <span className="text-gradient">drei Perspektiven</span>
              </h2>
              <p className="text-muted-foreground">Gleiches System, passende Argumente für jede Rolle.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {[
                { to: '/pruefungstraining-azubis', icon: GraduationCap, color: 'text-primary', title: 'Für Auszubildende', text: 'Prüfung simulieren, Schwächen erkennen, sicher bestehen.' },
                { to: '/pruefungstraining-betriebe', icon: Building2, color: 'text-accent', title: 'Für Ausbildungsbetriebe', text: 'Bestehensquoten erhöhen, Prüfungsreife messbar machen.' },
                { to: '/pruefungstraining-institutionen', icon: BookOpen, color: 'text-success', title: 'Für Berufsschulen & IHK', text: 'Prüfungskonforme Ergänzung, nicht Ersatz des Unterrichts.' },
              ].map(({ to, icon: Icon, color, title, text }) => (
                <Link key={to} to={to} className="glass-card rounded-2xl p-6 sm:p-8 group hover:border-primary/30 transition-all duration-300">
                  <Icon className={`h-10 w-10 ${color} mb-4`} />
                  <h3 className="text-lg font-display font-bold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{text}</p>
                  <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                    Mehr erfahren <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4">
          <div className="container mx-auto max-w-4xl">
            <div className="glass-strong rounded-3xl p-6 sm:p-8 md:p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 gradient-hero opacity-10" />
              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
                  <Zap className="h-8 w-8 text-accent" />
                </div>
                <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                  Starte jetzt dein Prüfungstraining
                </h2>
                <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                  Einmalig zahlen, 12 Monate trainieren. Kein Abo, keine versteckten Kosten.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link to="/shop">
                    <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 group">
                      Prüfungstraining starten – 39 €
                      <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                  {!user && (
                    <Link to="/auth">
                      <Button size="lg" variant="outline" className="rounded-xl h-14 px-8">
                        Kostenlos registrieren
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Sticky CTA Bar */}
        <StickyCTA />
      </div>
    </>
  );
}
