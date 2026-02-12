import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ActiveCourseProvider } from '@/contexts/ActiveCourseContext';
import ActiveCourseBar from '@/components/admin/ActiveCourseBar';
import {
  LayoutDashboard, BookOpen, LogOut, ChevronLeft, Menu,
  DollarSign, Activity, Brain, ChevronDown, Shield,
  TrendingUp, Layers, Search, Radio
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import CommandPalette from '@/components/admin/CommandPalette';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  children?: { path: string; label: string }[];
}

const navModules: NavItem[] = [
  { path: '/admin/command', label: 'Leitstelle', icon: LayoutDashboard },
  {
    path: '/admin/studio', label: 'Kurs-Studio', icon: BookOpen,
    children: [
      { path: '/admin/studio', label: 'Pakete' },
      { path: '/admin/studio/new', label: 'Neues Paket' },
    ],
  },
  {
    path: '/admin/quality', label: 'Qualität', icon: Shield,
    children: [
      { path: '/admin/quality', label: 'Übersicht' },
      { path: '/admin/quality/integrity', label: 'Integrität' },
      { path: '/admin/quality/compliance', label: 'Compliance' },
      { path: '/admin/quality/azav', label: 'AZAV/ISO' },
    ],
  },
  {
    path: '/admin/ops', label: 'System & Betrieb', icon: Activity,
    children: [
      { path: '/admin/ops', label: 'Queue' },
      { path: '/admin/ops/logs', label: 'Live Logs' },
      { path: '/admin/ops/deadletter', label: 'Dead Letter' },
      { path: '/admin/ops/health', label: 'Health' },
      { path: '/admin/ops/ai-workers', label: 'AI Workers' },
    ],
  },
  {
    path: '/admin/business', label: 'Finanzen', icon: DollarSign,
    children: [
      { path: '/admin/business', label: 'Umsatz' },
      { path: '/admin/business/licenses', label: 'Lizenzen' },
      { path: '/admin/business/exports', label: 'Steuer-Export' },
    ],
  },
  {
    path: '/admin/growth', label: 'Wachstum & CRM', icon: TrendingUp,
    children: [
      { path: '/admin/growth', label: 'Churn' },
      { path: '/admin/growth/nudges', label: 'Nudge Engine' },
      { path: '/admin/growth/feedback', label: 'Feedback' },
    ],
  },
  {
    path: '/admin/scale', label: 'Skalierung', icon: Layers,
    children: [
      { path: '/admin/scale', label: 'Berufe-Status' },
      { path: '/admin/scale/reporting', label: 'Reporting' },
    ],
  },
  { path: '/admin/pipeline', label: 'Pipeline Monitor', icon: Radio },
];

export default function AdminV4Layout() {
  const { user, loading, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  // Breadcrumbs
  const pathParts = location.pathname.replace('/admin/', '').split('/').filter(Boolean);
  const breadcrumbLabels: Record<string, string> = {
    command: 'Leitstelle', studio: 'Kurs-Studio', quality: 'Qualität',
    ops: 'System', business: 'Finanzen', growth: 'Wachstum', scale: 'Skalierung',
    new: 'Neues Paket', integrity: 'Integrität', compliance: 'Compliance',
    azav: 'AZAV/ISO', logs: 'Live Logs', deadletter: 'Dead Letter',
    health: 'Health', 'ai-workers': 'AI Workers', licenses: 'Lizenzen',
    exports: 'Exporte', nudges: 'Nudge Engine', feedback: 'Feedback',
    reporting: 'Reporting',
    pipeline: 'Pipeline Monitor',
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm flex items-center justify-between px-4">
        <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 rounded-lg hover:bg-muted">
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold text-sm">ExamFit Admin</span>
        <button onClick={() => setCmdOpen(true)} className="p-2 rounded-lg hover:bg-muted">
          <Search className="h-4 w-4" />
        </button>
      </header>

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full z-50 bg-card border-r border-border transition-all duration-200 flex flex-col",
        "lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarCollapsed ? "w-16" : "w-56"
      )}>
        {/* Logo */}
        <div className={cn(
          "flex items-center gap-2 h-14 px-4 border-b border-border shrink-0",
          sidebarCollapsed && "justify-center px-2"
        )}>
          <div className="p-1.5 rounded-lg bg-primary shrink-0">
            <Brain className="h-4 w-4 text-primary-foreground" />
          </div>
          {!sidebarCollapsed && (
            <span className="font-bold text-sm text-foreground truncate">ExamFit Admin</span>
          )}
        </div>

        {/* Search trigger */}
        {!sidebarCollapsed && (
          <button
            onClick={() => setCmdOpen(true)}
            className="mx-2 mt-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Suchen…</span>
            <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navModules.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path
              || location.pathname.startsWith(item.path + '/')
              || (item.children?.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/')));
            const hasChildren = item.children && item.children.length > 0;

            return (
              <div key={item.path}>
                <Link
                  to={hasChildren ? item.children![0].path : item.path}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {hasChildren && <ChevronDown className={cn("h-3 w-3 transition-transform", isActive && "rotate-180")} />}
                    </>
                  )}
                </Link>
                {/* Sub-items */}
                {hasChildren && isActive && !sidebarCollapsed && (
                  <div className="ml-7 mt-0.5 space-y-0.5">
                    {item.children!.map(child => {
                      const childActive = location.pathname === child.path;
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "block px-3 py-1.5 rounded-md text-xs transition-colors",
                            childActive
                              ? "text-primary font-medium bg-primary/5"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-2 space-y-1 border-t border-border shrink-0">
          <Link
            to="/"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
              sidebarCollapsed && "justify-center px-2"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            {!sidebarCollapsed && <span>Zurück</span>}
          </Link>
          <button
            onClick={() => signOut()}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full",
              sidebarCollapsed && "justify-center px-2"
            )}
          >
            <LogOut className="h-4 w-4" />
            {!sidebarCollapsed && <span>Abmelden</span>}
          </button>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", sidebarCollapsed && "rotate-180")} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={cn(
        "flex-1 min-h-screen transition-all duration-200",
        sidebarCollapsed ? "lg:ml-16" : "lg:ml-56",
        "pt-14 lg:pt-0"
      )}>
        <ActiveCourseProvider>
          <ActiveCourseBar />
          {/* Breadcrumbs */}
          <div className="px-4 lg:px-6 pt-4 lg:pt-5">
            <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
              <Link to="/admin/command" className="hover:text-foreground transition-colors">Admin</Link>
              {pathParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span>/</span>
                  {i === pathParts.length - 1 ? (
                    <span className="text-foreground font-medium">{breadcrumbLabels[part] || part}</span>
                  ) : (
                    <Link
                      to={`/admin/${pathParts.slice(0, i + 1).join('/')}`}
                      className="hover:text-foreground transition-colors"
                    >
                      {breadcrumbLabels[part] || part}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="px-4 lg:px-6 pb-6 max-w-[1400px]">
            <Outlet />
          </div>
        </ActiveCourseProvider>
      </main>

      {/* Command Palette */}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
