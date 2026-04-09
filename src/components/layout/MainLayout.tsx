import { Outlet } from 'react-router-dom';
import { ShareEventOrchestrator } from '@/components/share/ShareEventOrchestrator';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { GraduationCap, LogOut, User, Menu, X, Download } from 'lucide-react';
import { useState } from 'react';

import { useNativeApp } from '@/hooks/useNativeApp';

const NAV_ITEMS = [
  { to: '/berufe', label: 'Berufe' },
  { to: '/lernkurse', label: 'Lernkurse' },
  { to: '/pruefungstrainer', label: 'Prüfungstrainer' },
  { to: '/wissen', label: 'Wissen' },
  { to: '/preise', label: 'Preise' },
] as const;

export default function MainLayout() {
  const { user, signOut, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isNative } = useNativeApp();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-background">
      {user && <ShareEventOrchestrator />}
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary text-primary-foreground">
                <GraduationCap className="h-5 w-5" />
              </div>
              <span className="font-display font-bold text-lg text-foreground hidden sm:inline">
                ExamFit
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map(({ to, label }) => (
              <Link key={to} to={to} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
                {label}
              </Link>
            ))}
            {user && (
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
                Dashboard
              </Link>
            )}
          </nav>

          {/* Auth & Utils Buttons */}
          <div className="hidden md:flex items-center gap-2">
            <ThemeToggle />
            
            <Link to="/installieren" className="hidden lg:flex">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1">
                <Download className="h-4 w-4" />
                <span className="hidden xl:inline">App</span>
              </Button>
            </Link>

            {loading ? null : user ? (
              <>
                <Link to="/dashboard">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                    <User className="h-4 w-4 mr-2" />
                    <span className="hidden lg:inline">
                      {user.user_metadata?.full_name || user.email?.split('@')[0]}
                    </span>
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground">
                  <LogOut className="h-4 w-4" />
                  <span className="hidden lg:inline ml-2">Abmelden</span>
                </Button>
              </>
            ) : (
              <Link to="/auth">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Anmelden
                </Button>
              </Link>
            )}
          </div>

          {/* Mobile: Theme Toggle + Menu */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              className="p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Menü öffnen"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-background border-t border-border">
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-1">
              {NAV_ITEMS.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="text-foreground py-3 px-2 rounded-lg hover:bg-muted transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {label}
                </Link>
              ))}
              {user && (
                <Link 
                  to="/dashboard" 
                  className="text-foreground py-3 px-2 rounded-lg hover:bg-muted transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
              )}
              
              <hr className="my-2 border-border" />
              
              <Link 
                to="/installieren" 
                className="text-foreground py-3 px-2 rounded-lg hover:bg-muted transition-colors flex items-center gap-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Download className="h-4 w-4" />
                App installieren
              </Link>

              {user ? (
                <Button variant="ghost" onClick={handleSignOut} className="justify-start px-2 h-12">
                  <LogOut className="h-4 w-4 mr-2" />
                  Abmelden
                </Button>
              ) : (
                <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full mt-2">
                    Anmelden
                  </Button>
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className={isNative ? 'pb-20' : ''}>
        <Outlet />
      </main>
      {/* Native Tab Bar is rendered in App.tsx with admin-route filtering */}

      {/* Footer - hidden in native/PWA mode */}
      {!isNative && (
      <footer className="border-t border-border mt-20 bg-muted/30">
        <div className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-primary text-primary-foreground">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <span className="font-display font-bold">ExamFit.de</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Deine Plattform für erfolgreiche IHK-Prüfungen.
              </p>
            </div>

            {/* Produkte */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Produkte</h4>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                <Link to="/lernkurse" className="hover:text-foreground transition-colors">Lernkurse</Link>
                <Link to="/pruefungstrainer" className="hover:text-foreground transition-colors">Prüfungstrainer</Link>
                <Link to="/bundle" className="hover:text-foreground transition-colors">Bundles</Link>
                <Link to="/preise" className="hover:text-foreground transition-colors">Preise</Link>
              </nav>
            </div>

            {/* Ressourcen */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Ressourcen</h4>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                <Link to="/berufe" className="hover:text-foreground transition-colors">Alle Berufe</Link>
                <Link to="/ihk-pruefungen" className="hover:text-foreground transition-colors">IHK-Prüfungen</Link>
                <Link to="/wissen" className="hover:text-foreground transition-colors">Wissen & Blog</Link>
                <Link to="/unternehmen" className="hover:text-foreground transition-colors">Für Unternehmen</Link>
              </nav>
            </div>

            {/* Rechtliches */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Rechtliches</h4>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                <Link to="/impressum" className="hover:text-foreground transition-colors">Impressum</Link>
                <Link to="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
                <Link to="/agb" className="hover:text-foreground transition-colors">AGB</Link>
                <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
                <Link to="/installieren" className="hover:text-foreground transition-colors">App installieren</Link>
              </nav>
            </div>
          </div>

          {/* IHK/HWK Disclaimer */}
          <div className="pt-6 text-center">
            <p className="text-xs text-muted-foreground/70">
              ExamFit ist ein unabhängiger Anbieter. Es besteht keine Verbindung, Partnerschaft 
              oder Zusammenarbeit mit der Industrie- und Handelskammer (IHK) oder Handwerkskammer (HWK).
            </p>
          </div>

          <div className="pt-6 border-t border-border mt-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <span className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} ExamFit.de – Alle Rechte vorbehalten.
            </span>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>Made in Germany 🇩🇪</span>
            </div>
          </div>
        </div>
      </footer>
      )}
    </div>
  );
}
