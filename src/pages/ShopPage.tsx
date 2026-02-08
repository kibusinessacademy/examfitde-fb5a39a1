import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ProductCards } from '@/components/shop/ProductCards';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, Clock, CreditCard, GraduationCap, LogOut, User, Menu, X } from 'lucide-react';

export default function ShopPage() {
  const { user, signOut, loading } = useAuth();
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: curricula, isLoading: curriculaLoading } = useQuery({
    queryKey: ['frozen-curricula'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      
      if (error) throw error;
      return data;
    },
  });

  // Auto-select first curriculum
  if (curricula?.length && !selectedCurriculumId) {
    setSelectedCurriculumId(curricula[0].id);
  }

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
            <Link to="/" className="flex items-center gap-3">
              <div className="p-2 rounded-xl gradient-primary shadow-glow-sm">
                <GraduationCap className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-display font-semibold text-lg text-foreground hidden sm:inline">
                H5P Lernplattform
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/courses" className="text-muted-foreground hover:text-foreground transition-colors">
              Kurse
            </Link>
            <Link to="/exam-trainer" className="text-muted-foreground hover:text-foreground transition-colors">
              Prüfungstrainer
            </Link>
            <Link to="/shop" className="text-foreground font-medium">
              Shop
            </Link>
            {user && (
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                Dashboard
              </Link>
            )}
          </nav>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-2">
            {loading ? null : user ? (
              <>
                <Link to="/dashboard">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                    <User className="h-4 w-4 mr-2" />
                    {user.user_metadata?.full_name || user.email?.split('@')[0]}
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-muted-foreground hover:text-foreground">
                  <LogOut className="h-4 w-4 mr-2" />
                  Abmelden
                </Button>
              </>
            ) : (
              <Link to="/auth">
                <Button className="gradient-primary text-primary-foreground shadow-glow-sm">
                  Anmelden
                </Button>
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden glass-strong border-t border-border">
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-4">
              <Link to="/courses" className="text-foreground py-2" onClick={() => setMobileMenuOpen(false)}>
                Kurse
              </Link>
              <Link to="/exam-trainer" className="text-foreground py-2" onClick={() => setMobileMenuOpen(false)}>
                Prüfungstrainer
              </Link>
              <Link to="/shop" className="text-foreground py-2 font-medium" onClick={() => setMobileMenuOpen(false)}>
                Shop
              </Link>
              {user && (
                <Link to="/dashboard" className="text-foreground py-2" onClick={() => setMobileMenuOpen(false)}>
                  Dashboard
                </Link>
              )}
              {user ? (
                <Button variant="ghost" onClick={() => signOut()} className="justify-start px-0">
                  <LogOut className="h-4 w-4 mr-2" />
                  Abmelden
                </Button>
              ) : (
                <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full gradient-primary text-primary-foreground">
                    Anmelden
                  </Button>
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="relative z-10">
        <div className="container py-12">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">
              Prüfungsvorbereitung kaufen
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Wähle das passende Paket für deine Prüfungsvorbereitung. 
              Einmalzahlung, 12 Monate Zugang, keine versteckten Kosten.
            </p>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap justify-center gap-6 mb-12">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="w-4 h-4 text-primary" />
              <span>Sichere Zahlung via Stripe</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4 text-primary" />
              <span>Sofortiger Zugang</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CreditCard className="w-4 h-4 text-primary" />
              <span>Einmalzahlung, kein Abo</span>
            </div>
          </div>

          {/* Curriculum Selector */}
          {curricula && curricula.length > 1 && (
            <div className="max-w-md mx-auto mb-12">
              <label className="block text-sm font-medium mb-2">
                Wähle deinen Ausbildungsberuf
              </label>
              <Select
                value={selectedCurriculumId || ''}
                onValueChange={setSelectedCurriculumId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Beruf auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {curricula.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Products */}
          {selectedCurriculumId ? (
            <ProductCards curriculumId={selectedCurriculumId} />
          ) : curriculaLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              Lade Produkte...
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Keine Curricula verfügbar.
            </div>
          )}

          {/* B2B Info */}
          <div className="mt-16 text-center">
            <Badge variant="outline" className="mb-4">Für Unternehmen & Schulen</Badge>
            <h2 className="text-2xl font-bold mb-2">Mehr als 5 Lizenzen?</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Wähle einfach die gewünschte Menge im Shop aus. 
              Ab 5 Lizenzen erhältst du automatisch Mengenrabatt. 
              Keine Anfrage nötig – einfach kaufen!
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="glass-subtle border-t border-border mt-20 relative z-10">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground">© 2026 H5P Lernplattform</span>
            </div>
            <nav className="flex gap-6 text-sm text-muted-foreground">
              <Link to="/impressum" className="hover:text-foreground transition-colors">Impressum</Link>
              <Link to="/privacy" className="hover:text-foreground transition-colors">Datenschutz</Link>
              <Link to="/terms" className="hover:text-foreground transition-colors">AGB</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
