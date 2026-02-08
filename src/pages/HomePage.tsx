import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { 
  BookOpen, 
  GraduationCap, 
  Target, 
  Award, 
  ArrowRight,
  CheckCircle,
  Shield,
  Clock,
  Brain,
  Mic,
  TrendingUp,
  Star
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="py-20 px-4 relative">
        <div className="container mx-auto text-center max-w-4xl relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
            <Star className="h-4 w-4 text-warning fill-warning" />
            <span className="text-sm text-muted-foreground">98% Bestehensquote bei unseren Nutzern</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-6 animate-fade-in">
            IHK-Prüfung{' '}
            <span className="text-gradient text-glow">sicher bestehen</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
            Dein digitaler Prüfungstrainer für die Abschlussprüfung. 
            Strukturierte Lernkurse, echte Prüfungsfragen und KI-gestützte mündliche Prüfungssimulation.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                Jetzt Produkt wählen
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
              <span>IHK-konforme Inhalte</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="text-4xl font-display font-bold text-gradient mb-2">5.000+</div>
              <div className="text-sm text-muted-foreground">Erfolgreiche Absolventen</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.35s' }}>
              <div className="text-4xl font-display font-bold text-gradient-accent mb-2">98%</div>
              <div className="text-sm text-muted-foreground">Bestehensquote</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <div className="text-4xl font-display font-bold text-gradient mb-2">500+</div>
              <div className="text-sm text-muted-foreground">Prüfungsrelevante Fragen</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.45s' }}>
              <div className="text-4xl font-display font-bold text-gradient-accent mb-2">24/7</div>
              <div className="text-sm text-muted-foreground">Lernen wann du willst</div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem → Solution */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
            Prüfungsangst? Nicht mit <span className="text-gradient">ExamFit</span>.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Viele Azubis scheitern nicht am Wissen, sondern an der Prüfungssituation. 
            ExamFit trainiert nicht nur Inhalte, sondern auch Prüfungssicherheit.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">😰</div>
              <h3 className="font-semibold mb-2">Das Problem</h3>
              <p className="text-sm text-muted-foreground">
                Klassische Bücher und Karteikarten bereiten dich nicht auf echte Prüfungsfragen vor.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">🧠</div>
              <h3 className="font-semibold mb-2">Unsere Lösung</h3>
              <p className="text-sm text-muted-foreground">
                Adaptive Lernalgorithmen erkennen deine Schwächen und trainieren gezielt.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="font-semibold mb-2">Dein Ergebnis</h3>
              <p className="text-sm text-muted-foreground">
                Du gehst selbstsicher in die Prüfung – vorbereitet auf alles, was kommt.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Products Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Drei Wege zum <span className="text-gradient">Prüfungserfolg</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Wähle das passende Produkt für deine Prüfungsvorbereitung.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Lernkurs */}
            <div className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <div className="p-4 rounded-2xl gradient-primary w-fit shadow-glow-sm mb-6 group-hover:shadow-glow transition-shadow">
                <BookOpen className="h-8 w-8 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">Lernkurs</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold">19€</span>
                <span className="text-muted-foreground text-sm">einmalig</span>
              </div>
              <p className="text-muted-foreground mb-4">
                Verstehe alle Inhalte deines Ausbildungsberufs – strukturiert und verständlich.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Alle Lernfelder abgedeckt
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Verständliche Erklärungen
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  KI-Tutor für Fragen
                </li>
              </ul>
              <Link to="/lernkurse">
                <Button variant="outline" className="w-full rounded-xl">
                  Lernkurse ansehen <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>

            {/* Prüfungstrainer */}
            <div className="glass-card rounded-2xl p-8 group hover:border-accent/30 transition-all duration-500">
              <div className="p-4 rounded-2xl gradient-accent w-fit shadow-glow-accent mb-6 group-hover:shadow-glow-accent transition-shadow">
                <Target className="h-8 w-8 text-accent-foreground" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">Prüfungstrainer</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold">29€</span>
                <span className="text-muted-foreground text-sm">einmalig</span>
              </div>
              <p className="text-muted-foreground mb-4">
                Trainiere mit echten IHK-Prüfungsfragen und lerne aus deinen Fehlern.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Echte Prüfungsfragen
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Schwächenanalyse
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Prüfungssimulation
                </li>
              </ul>
              <Link to="/pruefungstrainer">
                <Button variant="outline" className="w-full rounded-xl">
                  Trainer ansehen <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>

            {/* Bundle */}
            <div className="glass-card rounded-2xl p-8 group border-2 border-primary/30 relative hover:border-primary/50 transition-all duration-500">
              <div className="absolute -top-3 right-4">
                <Badge className="bg-primary text-primary-foreground border-primary">
                  Bestseller
                </Badge>
              </div>
              <div className="p-4 rounded-2xl gradient-accent w-fit shadow-glow-accent mb-6">
                <Award className="h-8 w-8 text-accent-foreground" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">Komplett-Bundle</h3>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold">39€</span>
                <span className="text-muted-foreground text-sm line-through">48€</span>
              </div>
              <p className="text-muted-foreground mb-4">
                Alles in einem: Lernen, Üben und mündliche Prüfungssimulation.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-success" />
                  Lernkurs + Prüfungstrainer
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-success" />
                  Mündliche Prüfungssimulation
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-success" />
                  KI-Prüfer mit Feedback
                </li>
              </ul>
              <Link to="/bundle">
                <Button className="w-full gradient-primary shadow-glow rounded-xl">
                  Bundle ansehen <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
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
            <div className="glass-card rounded-2xl p-6 text-center">
              <Brain className="h-10 w-10 text-primary mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Adaptives Lernen</h3>
              <p className="text-sm text-muted-foreground">
                Das System erkennt deine Schwächen und trainiert gezielt.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <Mic className="h-10 w-10 text-accent mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Mündliche Prüfung</h3>
              <p className="text-sm text-muted-foreground">
                Übe das Fachgespräch mit KI-Feedback zu deinen Antworten.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <TrendingUp className="h-10 w-10 text-success mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Erfolgsgarantie</h3>
              <p className="text-sm text-muted-foreground">
                98% unserer Nutzer bestehen die Prüfung beim ersten Versuch.
              </p>
            </div>
            <div className="glass-card rounded-2xl p-6 text-center">
              <GraduationCap className="h-10 w-10 text-warning mx-auto mb-4" />
              <h3 className="font-semibold mb-2">IHK-konform</h3>
              <p className="text-sm text-muted-foreground">
                Alle Inhalte basieren auf offiziellen Rahmenlehrplänen.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="glass-strong rounded-3xl p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 gradient-hero opacity-10" />
            <div className="relative z-10">
              <GraduationCap className="h-16 w-16 text-primary mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                Starte jetzt in eine sichere Prüfung
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Einmalig zahlen, 12 Monate lernen. Kein Abo, keine versteckten Kosten.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/shop">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8">
                    Jetzt Produkt wählen
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
