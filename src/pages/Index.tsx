import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  BookOpen, 
  GraduationCap, 
  Users, 
  BarChart3, 
  ArrowRight, 
  LogOut,
  Settings,
  Loader2
} from 'lucide-react';

export default function Index() {
  const { user, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
      <div className="orb orb-accent w-80 h-80 top-1/3 -right-40 fixed" />
      <div className="orb orb-rose w-72 h-72 bottom-20 left-1/4 fixed" />

      {/* Header */}
      <header className="glass-subtle sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl gradient-primary shadow-glow-sm">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display font-semibold text-lg text-foreground">H5P Lernplattform</span>
          </div>
          
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/admin">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-muted/50">
                  <Settings className="h-4 w-4 mr-2" />
                  Admin
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground hover:bg-muted/50">
              <LogOut className="h-4 w-4 mr-2" />
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4 relative">
        <div className="container mx-auto text-center max-w-3xl relative z-10">
          <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
            Willkommen zurück,{' '}
            <span className="text-gradient text-glow">
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            Wählen Sie einen Bereich, um Ihr Lernen fortzusetzen
          </p>
        </div>
      </section>

      {/* Main Navigation Cards */}
      <section className="pb-20 px-4 relative z-10">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Learning Courses */}
            <div className="glass-card rounded-2xl p-8 group hover:border-primary/30 transition-all duration-500 hover:shadow-glow animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="mb-6">
                <div className="p-4 rounded-2xl gradient-primary w-fit shadow-glow group-hover:shadow-glow transition-shadow">
                  <BookOpen className="h-10 w-10 text-primary-foreground" />
                </div>
              </div>
              <h2 className="text-2xl font-display font-bold mb-3 text-foreground">Lernkurse</h2>
              <p className="text-muted-foreground mb-6">
                Strukturiertes Lernen mit der 5-Schritte-Didaktik. Interaktive H5P-Inhalte für optimalen Lernerfolg.
              </p>
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-primary shadow-glow-sm" />
                  Einstieg - Aktivierung des Vorwissens
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-primary shadow-glow-sm" />
                  Verstehen - Theorie und Konzepte
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-primary shadow-glow-sm" />
                  Anwenden - Praktische Übungen
                </div>
              </div>
              <Link to="/courses">
                <Button className="w-full gradient-primary text-primary-foreground shadow-glow hover:shadow-glow transition-all rounded-xl h-12">
                  Kurse entdecken
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>

            {/* Exam Trainer */}
            <div className="glass-card rounded-2xl p-8 group hover:border-accent/30 transition-all duration-500 hover:shadow-glow-accent animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="mb-6">
                <div className="p-4 rounded-2xl gradient-accent w-fit shadow-glow-accent group-hover:shadow-glow-accent transition-shadow">
                  <GraduationCap className="h-10 w-10 text-accent-foreground" />
                </div>
              </div>
              <h2 className="text-2xl font-display font-bold mb-3 text-foreground">Prüfungstrainer</h2>
              <p className="text-muted-foreground mb-6">
                Bereiten Sie sich optimal auf Prüfungen vor. 500+ KI-generierte Fragen mit Erklärungen.
              </p>
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-accent shadow-glow-accent" />
                  Multiple-Choice-Fragen aller Schwierigkeitsgrade
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-accent shadow-glow-accent" />
                  Sofortige Auswertung mit Erklärungen
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-accent shadow-glow-accent" />
                  Personalisierte Schwächen-Analyse
                </div>
              </div>
              <Link to="/exams">
                <Button className="w-full gradient-accent text-accent-foreground shadow-glow-accent hover:shadow-glow-accent transition-all rounded-xl h-12">
                  Training starten
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            <div className="glass-card rounded-xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <div className="text-4xl font-display font-bold text-gradient mb-2">0</div>
              <div className="text-sm text-muted-foreground">Kurse abgeschlossen</div>
            </div>
            <div className="glass-card rounded-xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.45s' }}>
              <div className="text-4xl font-display font-bold text-gradient-accent mb-2">0</div>
              <div className="text-sm text-muted-foreground">Fragen beantwortet</div>
            </div>
            <div className="glass-card rounded-xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.5s' }}>
              <div className="text-4xl font-display font-bold text-success text-glow-accent mb-2">0%</div>
              <div className="text-sm text-muted-foreground">Erfolgsquote</div>
            </div>
            <div className="glass-card rounded-xl text-center p-6 animate-fade-in" style={{ animationDelay: '0.55s' }}>
              <div className="text-4xl font-display font-bold text-warning mb-2">0</div>
              <div className="text-sm text-muted-foreground">Tage Streak</div>
            </div>
          </div>
        </div>
      </section>

      {/* Admin Quick Access */}
      {isAdmin && (
        <section className="pb-20 px-4 relative z-10">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl font-display font-semibold mb-6 text-foreground">Admin-Bereich</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <Link to="/admin/curricula">
                <div className="glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300 cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-muted/50 group-hover:gradient-primary group-hover:shadow-glow-sm transition-all">
                      <BookOpen className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Curricula</div>
                      <div className="text-sm text-muted-foreground">Lehrpläne importieren</div>
                    </div>
                  </div>
                </div>
              </Link>
              
              <Link to="/admin/questions">
                <div className="glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300 cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-muted/50 group-hover:gradient-primary group-hover:shadow-glow-sm transition-all">
                      <Users className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Fragen</div>
                      <div className="text-sm text-muted-foreground">Prüfungsfragen verwalten</div>
                    </div>
                  </div>
                </div>
              </Link>
              
              <Link to="/admin/analytics">
                <div className="glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300 cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-muted/50 group-hover:gradient-primary group-hover:shadow-glow-sm transition-all">
                      <BarChart3 className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Analytics</div>
                      <div className="text-sm text-muted-foreground">Statistiken einsehen</div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
