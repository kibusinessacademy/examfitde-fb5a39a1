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
  Users,
  Zap
} from 'lucide-react';

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="py-20 px-4 relative">
        <div className="container mx-auto text-center max-w-4xl relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
            <Zap className="h-4 w-4 text-accent" />
            <span className="text-sm text-muted-foreground">KI-gestützte Lernplattform</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-6 animate-fade-in">
            Meistere deine{' '}
            <span className="text-gradient text-glow">IHK-Prüfung</span>
            <br />mit Leichtigkeit
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
            Interaktive H5P-Kurse, KI-generierte Prüfungsfragen und adaptive Lernpfade 
            für deinen optimalen Lernerfolg.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <Link to="/courses">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-14 px-8 text-lg">
                Kurse entdecken
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            {!user && (
              <Link to="/auth">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  Kostenlos starten
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="text-4xl font-display font-bold text-gradient mb-2">5.000+</div>
              <div className="text-sm text-muted-foreground">Zufriedene Lerner</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.35s' }}>
              <div className="text-4xl font-display font-bold text-gradient-accent mb-2">98%</div>
              <div className="text-sm text-muted-foreground">Bestehensquote</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <div className="text-4xl font-display font-bold text-gradient mb-2">500+</div>
              <div className="text-sm text-muted-foreground">Prüfungsfragen</div>
            </div>
            <div className="glass-card rounded-2xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.45s' }}>
              <div className="text-4xl font-display font-bold text-gradient-accent mb-2">24/7</div>
              <div className="text-sm text-muted-foreground">Lernzugriff</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Warum <span className="text-gradient">H5P Lernplattform</span>?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Unsere Plattform kombiniert bewährte Didaktik mit modernster KI-Technologie.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <div className="p-4 rounded-2xl gradient-primary w-fit shadow-glow-sm mb-6 group-hover:shadow-glow transition-shadow">
                <BookOpen className="h-8 w-8 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-display font-bold mb-3">5-Schritte-Didaktik</h3>
              <p className="text-muted-foreground mb-4">
                Strukturiertes Lernen mit Einstieg, Verstehen, Anwenden, Wiederholen und Mini-Check.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Aktivierung des Vorwissens
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Interaktive H5P-Inhalte
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Sofortiges Feedback
                </li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="glass-card rounded-2xl p-8 group hover:border-accent/30 transition-all duration-500">
              <div className="p-4 rounded-2xl gradient-accent w-fit shadow-glow-accent mb-6 group-hover:shadow-glow-accent transition-shadow">
                <Target className="h-8 w-8 text-accent-foreground" />
              </div>
              <h3 className="text-xl font-display font-bold mb-3">KI-Prüfungstrainer</h3>
              <p className="text-muted-foreground mb-4">
                Über 500 KI-generierte Prüfungsfragen mit adaptivem Schwierigkeitsgrad.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Personalisierte Schwächenanalyse
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Ausführliche Erklärungen
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-accent" />
                  Prüfungssimulation
                </li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 w-fit shadow-lg mb-6">
                <Award className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-display font-bold mb-3">Zertifizierte Inhalte</h3>
              <p className="text-muted-foreground mb-4">
                Alle Kurse basieren auf aktuellen IHK-Rahmenlehrplänen.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  IHK-konform
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Regelmäßige Updates
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Von Experten erstellt
                </li>
              </ul>
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
                Bereit für deinen Prüfungserfolg?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Starte jetzt kostenlos und entdecke unsere interaktiven Kurse.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/courses">
                  <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8">
                    Alle Kurse ansehen
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>
                </Link>
                {!user && (
                  <Link to="/auth">
                    <Button size="lg" variant="outline" className="rounded-xl h-14 px-8">
                      Account erstellen
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
