import { ReactNode, useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, Package, ListChecks, Menu, X, 
  LogOut, Sparkles, Globe, Play, FileText, HeadphonesIcon
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';

/** SSOT: 7 operative areas */
const NAV_ITEMS = [
  { to: '/admin/command', label: 'Leitstelle', icon: LayoutDashboard },
  { to: '/admin/studio', label: 'Kurse', icon: Package },
  { to: '/admin/pages', label: 'Pages', icon: FileText },
  { to: '/admin/queue', label: 'Queue', icon: ListChecks },
  { to: '/admin/growth', label: 'Growth', icon: Globe },
  { to: '/admin/support', label: 'Support', icon: HeadphonesIcon },
  { to: '/admin/test', label: 'Testen', icon: Play },
] as const;

interface Props {
  children: ReactNode;
}

export default function AdminV2Shell({ children }: Props) {
  const { signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

  // Close on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Track desktop breakpoint
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    setIsDesktop(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);
  
  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Mobile Header ── */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-50 h-[3.25rem] border-b border-border bg-background/95 backdrop-blur-sm flex items-center justify-between px-3">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2.5 rounded-lg hover:bg-muted active:bg-muted/80 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-md bg-primary/15">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="font-bold text-sm">ExamFit</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono text-muted-foreground">SSOT</Badge>
        </div>
        <div className="w-11" /> {/* spacer */}
      </header>

      {/* ── Mobile Overlay ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar (Desktop + Mobile Drawer) ── */}
      <aside
        {...(!isDesktop && !mobileOpen ? { inert: '' as any } : {})}
        className={cn(
          "fixed left-0 z-50 bg-card border-r border-border flex flex-col transition-transform duration-200",
          "lg:translate-x-0 lg:top-0 lg:h-full lg:w-56",
          "top-[3.25rem] h-[calc(100vh-3.25rem)] w-[280px]",
          mobileOpen ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none lg:translate-x-0 lg:pointer-events-auto",
        )}
        aria-hidden={!isDesktop && !mobileOpen ? true : undefined}
      >
        {/* Desktop Logo */}
        <div className="hidden lg:flex items-center gap-2 h-14 px-4 border-b border-border shrink-0">
          <div className="p-1.5 rounded-lg bg-primary/15 shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span className="font-bold text-sm text-foreground">ExamFit</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono text-muted-foreground">SSOT</Badge>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 pt-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin/studio'}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 pb-3 space-y-1 border-t border-border pt-3">
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/60 font-mono">
            Admin v2 · SSOT-only
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full min-h-[44px]"
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className={cn(
        "min-h-screen flex flex-col relative z-0",
        "pt-[3.25rem] lg:pt-0 lg:ml-56"
      )}>
        <div className="flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-6 pb-20 lg:pb-6 max-w-[1400px] w-full mx-auto">
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Tab Bar (top 5 items only) ── */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur px-2 py-1.5 lg:hidden safe-bottom">
        <div className="flex overflow-x-auto gap-1 px-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                "flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-center text-[10px] transition-colors min-h-[44px] min-w-[3.5rem] justify-center shrink-0",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
