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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg gradient-primary">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display font-semibold text-lg">H5P Lernplattform</span>
          </div>
          
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/admin">
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Admin
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 px-4">
        <div className="container mx-auto text-center max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-6 animate-fade-in">
            Willkommen zurück,{' '}
            <span className="text-gradient">
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            Wählen Sie einen Bereich, um Ihr Lernen fortzusetzen
          </p>
        </div>
      </section>

      {/* Main Navigation Cards */}
      <section className="pb-16 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Learning Courses */}
            <Card className="group hover:shadow-lg transition-all duration-300 hover:border-primary/50 animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <CardHeader>
                <div className="p-3 rounded-xl gradient-primary w-fit mb-4 group-hover:shadow-glow transition-shadow">
                  <BookOpen className="h-8 w-8 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl font-display">Lernkurse</CardTitle>
                <CardDescription className="text-base">
                  Strukturiertes Lernen mit der 5-Schritte-Didaktik. Interaktive H5P-Inhalte für optimalen Lernerfolg.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    Einstieg - Aktivierung des Vorwissens
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    Verstehen - Theorie und Konzepte
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    Anwenden - Praktische Übungen
                  </div>
                </div>
                <Link to="/courses">
                  <Button className="w-full group-hover:gradient-primary group-hover:text-primary-foreground transition-all">
                    Kurse entdecken
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Exam Trainer */}
            <Card className="group hover:shadow-lg transition-all duration-300 hover:border-accent/50 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <CardHeader>
                <div className="p-3 rounded-xl gradient-accent w-fit mb-4 group-hover:shadow-glow transition-shadow">
                  <GraduationCap className="h-8 w-8 text-accent-foreground" />
                </div>
                <CardTitle className="text-2xl font-display">Prüfungstrainer</CardTitle>
                <CardDescription className="text-base">
                  Bereiten Sie sich optimal auf Prüfungen vor. 500+ KI-generierte Fragen mit Erklärungen.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    Multiple-Choice-Fragen aller Schwierigkeitsgrade
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    Sofortige Auswertung mit Erklärungen
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    Personalisierte Schwächen-Analyse
                  </div>
                </div>
                <Link to="/exams">
                  <Button variant="outline" className="w-full group-hover:bg-accent group-hover:text-accent-foreground group-hover:border-accent transition-all">
                    Training starten
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Stats Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <Card className="text-center p-4 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <div className="text-3xl font-display font-bold text-primary">0</div>
              <div className="text-sm text-muted-foreground">Kurse abgeschlossen</div>
            </Card>
            <Card className="text-center p-4 animate-fade-in" style={{ animationDelay: '0.45s' }}>
              <div className="text-3xl font-display font-bold text-accent">0</div>
              <div className="text-sm text-muted-foreground">Fragen beantwortet</div>
            </Card>
            <Card className="text-center p-4 animate-fade-in" style={{ animationDelay: '0.5s' }}>
              <div className="text-3xl font-display font-bold text-success">0%</div>
              <div className="text-sm text-muted-foreground">Erfolgsquote</div>
            </Card>
            <Card className="text-center p-4 animate-fade-in" style={{ animationDelay: '0.55s' }}>
              <div className="text-3xl font-display font-bold text-warning">0</div>
              <div className="text-sm text-muted-foreground">Tage Streak</div>
            </Card>
          </div>
        </div>
      </section>

      {/* Admin Quick Access */}
      {isAdmin && (
        <section className="pb-16 px-4">
          <div className="container mx-auto max-w-5xl">
            <h2 className="text-2xl font-display font-semibold mb-6">Admin-Bereich</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <Link to="/admin/curricula">
                <Card className="hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="flex items-center gap-4 p-6">
                    <div className="p-2 rounded-lg bg-secondary group-hover:bg-primary transition-colors">
                      <BookOpen className="h-5 w-5 text-secondary-foreground group-hover:text-primary-foreground" />
                    </div>
                    <div>
                      <div className="font-medium">Curricula</div>
                      <div className="text-sm text-muted-foreground">Lehrpläne importieren</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              
              <Link to="/admin/questions">
                <Card className="hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="flex items-center gap-4 p-6">
                    <div className="p-2 rounded-lg bg-secondary group-hover:bg-primary transition-colors">
                      <Users className="h-5 w-5 text-secondary-foreground group-hover:text-primary-foreground" />
                    </div>
                    <div>
                      <div className="font-medium">Fragen</div>
                      <div className="text-sm text-muted-foreground">Prüfungsfragen verwalten</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              
              <Link to="/admin/analytics">
                <Card className="hover:shadow-md transition-shadow cursor-pointer group">
                  <CardContent className="flex items-center gap-4 p-6">
                    <div className="p-2 rounded-lg bg-secondary group-hover:bg-primary transition-colors">
                      <BarChart3 className="h-5 w-5 text-secondary-foreground group-hover:text-primary-foreground" />
                    </div>
                    <div>
                      <div className="font-medium">Analytics</div>
                      <div className="text-sm text-muted-foreground">Statistiken einsehen</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
