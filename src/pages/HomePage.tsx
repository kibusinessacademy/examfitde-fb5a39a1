import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
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
} from 'lucide-react';

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="py-20 px-4 relative">
        <div className="container mx-auto text-center max-w-4xl relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
            <Star className="h-4 w-4 text-warning fill-warning" />
            <span className="text-sm text-muted-foreground">98 % Bestehensquote bei unseren Nutzern</span>
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-6 animate-fade-in">
            IHK-Prüfung{' '}
            <span className="text-gradient text-glow">sicher bestehen</span>
          </h1>

          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
            Das intelligente Prüfungstrainings-System für Auszubildende.
            Trainiere exakt das, was geprüft wird – mit echten Prüfungsaufgaben, Simulationen und KI-Prüfungscoach.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                Prüfungstraining starten
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <Link to="/berufe">
              <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                Berufe entdecken
              </Button>
            </Link>
          </div>

          {/* Trust Indicators */}
          <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span>Einmalzahlung, kein Abo</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <span>12 Monate Zugang</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              <span>Basierend auf dem Ausbildungsrahmenplan</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: '5.000+', label: 'Erfolgreiche Absolventen', gradient: 'text-gradient' },
              { value: '98 %', label: 'Bestehensquote', gradient: 'text-gradient-accent' },
              { value: '500+', label: 'Prüfungsrelevante Aufgaben', gradient: 'text-gradient' },
              { value: '24/7', label: 'Trainieren wann du willst', gradient: 'text-gradient-accent' },
            ].map(({ value, label, gradient }, i) => (
              <div key={label} className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: `${0.3 + i * 0.05}s` }}>
                <div className={`text-4xl font-display font-bold ${gradient} mb-2`}>{value}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem → Solution */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
            Du verkaufst kein Lernen. Du verkaufst <span className="text-gradient">Prüfungssicherheit.</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Viele Azubis scheitern nicht am Wissen, sondern an der Prüfungssituation.
            ExamFit trainiert gezielt Prüfungsreife – nicht unnötige Theorie.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">😰</div>
              <h3 className="font-semibold mb-2">Das Problem</h3>
              <p className="text-sm text-muted-foreground">
                Klassische Bücher und Karteikarten bereiten nicht auf echte Prüfungsaufgaben vor.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">🧠</div>
              <h3 className="font-semibold mb-2">Unsere Lösung</h3>
              <p className="text-sm text-muted-foreground">
                Adaptive Algorithmen erkennen Schwächen und trainieren gezielt das, was geprüft wird.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="font-semibold mb-2">Dein Ergebnis</h3>
              <p className="text-sm text-muted-foreground">
                Du gehst prüfungsreif und selbstsicher in die Abschlussprüfung.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Ein Produkt */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Ein Produkt. Ein Ziel. <span className="text-gradient">Bestehen.</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-12">
            ExamFit – Intelligentes Prüfungstraining. Alles, was du für die Abschlussprüfung brauchst, in einem System.
          </p>

          <div className="glass-card rounded-2xl p-8 md:p-12 border-2 border-primary/30 max-w-2xl mx-auto">
            <div className="flex items-baseline gap-2 justify-center mb-6">
              <span className="text-5xl font-display font-bold text-gradient">39 €</span>
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
              <Button size="lg" className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg">
                Jetzt Prüfungstraining starten
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Das macht ExamFit <span className="text-gradient">besonders</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Brain, color: 'text-primary', title: 'Adaptives Training', text: 'Das System erkennt deine Schwächen und trainiert gezielt.' },
              { icon: Mic, color: 'text-accent', title: 'Mündliche Prüfung', text: 'Übe das Fachgespräch mit KI-Feedback zu deinen Antworten.' },
              { icon: TrendingUp, color: 'text-success', title: 'Prüfungsreife messen', text: '98 % unserer Nutzer bestehen die Prüfung beim ersten Versuch.' },
              { icon: Target, color: 'text-warning', title: 'Nach Rahmenplan', text: 'Alle Inhalte basieren auf dem offiziellen Ausbildungsrahmenplan.' },
            ].map(({ icon: Icon, color, title, text }) => (
              <div key={title} className="glass-card rounded-2xl p-6 text-center">
                <Icon className={`h-10 w-10 ${color} mx-auto mb-4`} />
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Zielgruppen-Einstiege */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Ein Produkt – <span className="text-gradient">drei Perspektiven</span>
            </h2>
            <p className="text-muted-foreground">Gleiches System, passende Argumente für jede Rolle.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Link to="/pruefungstraining-azubis" className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <GraduationCap className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-lg font-display font-bold mb-2">Für Auszubildende</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Prüfung simulieren, Schwächen erkennen, sicher bestehen.
              </p>
              <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                Mehr erfahren <ArrowRight className="h-4 w-4" />
              </span>
            </Link>

            <Link to="/pruefungstraining-betriebe" className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <Building2 className="h-10 w-10 text-accent mb-4" />
              <h3 className="text-lg font-display font-bold mb-2">Für Ausbildungsbetriebe</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Bestehensquoten erhöhen, Prüfungsreife messbar machen.
              </p>
              <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                Mehr erfahren <ArrowRight className="h-4 w-4" />
              </span>
            </Link>

            <Link to="/pruefungstraining-institutionen" className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <BookOpen className="h-10 w-10 text-success mb-4" />
              <h3 className="text-lg font-display font-bold mb-2">Für Berufsschulen & IHK</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Prüfungskonforme Ergänzung, nicht Ersatz des Unterrichts.
              </p>
              <span className="text-sm text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                Mehr erfahren <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="glass-strong rounded-3xl p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 gradient-hero opacity-10" />
            <div className="relative z-10">
              <Target className="h-16 w-16 text-primary mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                Starte jetzt dein Prüfungstraining
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Einmalig zahlen, 12 Monate trainieren. Kein Abo, keine versteckten Kosten.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/shop">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8">
                    Prüfungstraining starten
                    <ArrowRight className="h-5 w-5 ml-2" />
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
    </div>
  );
}
