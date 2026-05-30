import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Home, BookOpen, Target, Award, GraduationCap, Building2, CreditCard, Menu, Search, User, LogOut, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useState } from 'react';
import { TopicMapNav } from '@/components/seo/TopicMapNav';
import { useAuth } from '@/hooks/useAuth';

const navigation = [
  { name: 'IHK-Prüfungen', href: '/ihk-pruefungen', icon: Home },
  { name: 'Komplettpaket', href: '/paket', icon: Award },
  { name: 'Berufe', href: '/berufe', icon: GraduationCap },
  { name: 'Unternehmen', href: '/unternehmen', icon: Building2 },
  { name: 'Preise', href: '/preise', icon: CreditCard },
];

export default function SEOLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const navigate = useNavigate();
  // Reality-Audit Fix: Auth-State-Drift — SEOLayout zeigte "Login/Jetzt starten" auch für eingeloggte User
  const { user, signOut, loading } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="container">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                <span className="text-text-on-gradient font-bold text-lg">E</span>
              </div>
              <span className="font-display font-bold text-xl">ExamFit</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.name}
                </Link>
              ))}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Desktop Search */}
              <div className="hidden lg:flex items-center gap-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Beruf suchen…"
                    className="h-8 w-48 pl-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQ.trim().length >= 2) {
                        navigate(`/suche?q=${encodeURIComponent(searchQ.trim())}`);
                        setSearchQ('');
                      }
                    }}
                  />
                </div>
              </div>
              {loading ? null : user ? (
                <>
                  <Link to="/dashboard" className="hidden sm:block">
                    <Button variant="ghost" size="sm" className="gap-1">
                      <LayoutDashboard className="h-4 w-4" />
                      <span className="hidden md:inline">Dashboard</span>
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => signOut()} aria-label="Abmelden">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/auth" className="hidden sm:block">
                    <Button variant="ghost" size="sm">
                      Login
                    </Button>
                  </Link>
                  <Link to="/shop">
                    <Button size="sm" className="shadow-glow-sm">
                      Jetzt starten
                    </Button>
                  </Link>
                </>
              )}

              {/* Mobile Menu */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild className="lg:hidden">
                  <Button variant="ghost" size="icon">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[300px] glass">
                  <nav className="flex flex-col gap-2 mt-8">
                    {navigation.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={() => setMobileOpen(false)}
                          className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <Icon className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">{item.name}</span>
                        </Link>
                      );
                    })}
                    <hr className="my-4 border-border" />
                    {user ? (
                      <>
                        <Link
                          to="/dashboard"
                          onClick={() => setMobileOpen(false)}
                          className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">Dashboard</span>
                        </Link>
                        <button
                          onClick={() => { setMobileOpen(false); signOut(); }}
                          className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                        >
                          <LogOut className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">Abmelden</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          to="/auth"
                          onClick={() => setMobileOpen(false)}
                          className="px-4 py-3 text-center rounded-lg border border-border hover:bg-muted/50 transition-colors"
                        >
                          Login
                        </Link>
                        <Link
                          to="/shop"
                          onClick={() => setMobileOpen(false)}
                        >
                          <Button className="w-full">Jetzt starten</Button>
                        </Link>
                      </>
                    )}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50">
        <div className="container py-12">
          <TopicMapNav />
          <div className="grid md:grid-cols-4 gap-8">
            {/* Brand */}
            <div>
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                  <span className="text-text-on-gradient font-bold text-lg">E</span>
                </div>
                <span className="font-display font-bold text-xl">ExamFit</span>
              </Link>
              <p className="text-sm text-muted-foreground">
                KI-gestützte IHK-Prüfungsvorbereitung für Auszubildende in Deutschland.
              </p>
            </div>

            {/* Products */}
            <div>
              <h2 className="font-semibold mb-4">Produkte</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/paket" className="hover:text-foreground">Komplettpaket</Link></li>
                <li><Link to="/berufe" className="hover:text-foreground">Berufe</Link></li>
                <li><Link to="/preise" className="hover:text-foreground">Preise</Link></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h2 className="font-semibold mb-4">Ressourcen</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/ihk-pruefungen" className="hover:text-foreground">IHK-Prüfungen</Link></li>
                <li><Link to="/berufe" className="hover:text-foreground">Berufe</Link></li>
                <li><Link to="/wissen" className="hover:text-foreground">Wissen</Link></li>
                <li><Link to="/unternehmen" className="hover:text-foreground">Für Unternehmen</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h2 className="font-semibold mb-4">Rechtliches</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/impressum" className="hover:text-foreground">Impressum</Link></li>
                <li><Link to="/datenschutz" className="hover:text-foreground">Datenschutz</Link></li>
                <li><Link to="/agb" className="hover:text-foreground">AGB</Link></li>
                <li><Link to="/faq" className="hover:text-foreground">FAQ</Link></li>
                <li><a href="mailto:kontakt@examfit.de" className="hover:text-foreground">Kontakt</a></li>
              </ul>
            </div>
          </div>

          {/* IHK/HWK Disclaimer */}
          <div className="border-t border-border mt-8 pt-8">
            <p className="text-xs text-muted-foreground text-center mb-6">
              ExamFit ist ein unabhängiger Anbieter. Es besteht keine Verbindung, Partnerschaft 
              oder Zusammenarbeit mit der Industrie- und Handelskammer (IHK) oder Handwerkskammer (HWK).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} ExamFit. Alle Rechte vorbehalten.
            </p>
            <p className="text-sm text-muted-foreground">
              Made with ❤️ in Germany
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
