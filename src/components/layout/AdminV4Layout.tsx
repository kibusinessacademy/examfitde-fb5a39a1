import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ActiveCourseProvider } from '@/contexts/ActiveCourseContext';
import ActiveCourseBar from '@/components/admin/ActiveCourseBar';
import GlobalStatusBar from '@/components/admin/GlobalStatusBar';
import {
  LogOut, ChevronLeft, Menu, Brain, ChevronDown, Search,
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import CommandPalette from '@/components/admin/CommandPalette';
import NotificationBell from '@/components/admin/NotificationBell';
import { adminNavModules } from '@/admin/adminNav';

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

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Body scroll lock when mobile drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

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
    command: 'Leitstelle', studio: 'Factory', quality: 'Qualität',
    ops: 'Ops', business: 'Finanzen', growth: 'Wachstum', scale: 'Skalierung',
    content: 'Content & SEO', crm: 'CRM', support: 'Support',
    new: 'Neues Paket', integrity: 'Integrität', compliance: 'Compliance',
    azav: 'AZAV/ISO', logs: 'Live Logs', deadletter: 'Dead Letter',
    health: 'Health', 'ai-workers': 'AI Workers', licenses: 'Lizenzen',
    exports: 'Exporte', nudges: 'Nudge Engine', feedback: 'Feedback',
    reporting: 'Reporting', pipeline: 'Pipeline Live',
    review: 'Review Inbox', 'load-control': 'Load Control',
    blog: 'Blog', assets: 'Assets', seo: 'SEO & Redirects',
    segments: 'Segmente', churn: 'Churn Risk',
    tickets: 'Tickets', faq: 'FAQ Knüpfung',
    handbook: 'Handbuch',
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
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur-sm flex items-center justify-between px-3">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2.5 rounded-lg hover:bg-muted active:bg-muted/80 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold text-sm">ExamFit Admin</span>
        <div className="flex items-center gap-0.5">
          <NotificationBell />
          <button
            onClick={() => setCmdOpen(true)}
            className="p-2.5 rounded-lg hover:bg-muted active:bg-muted/80 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={cn(
        "fixed left-0 z-50 bg-card border-r border-border transition-all duration-200 flex flex-col",
        // Desktop: full height from top
        "lg:top-0 lg:h-full lg:translate-x-0",
        // Mobile: below header, full remaining height, wider drawer
        "top-14 h-[calc(100vh-3.5rem)]",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarCollapsed ? "lg:w-16 w-[85vw] max-w-[320px]" : "lg:w-56 w-[85vw] max-w-[320px]"
      )}>
        {/* Logo — hidden on mobile (header is visible) */}
        <div className={cn(
          "hidden lg:flex items-center gap-2 h-14 px-4 border-b border-border shrink-0",
          sidebarCollapsed && "justify-center px-2"
        )}>
          <div className="p-1.5 rounded-lg bg-primary shrink-0">
            <Brain className="h-4 w-4 text-primary-foreground" />
          </div>
          {!sidebarCollapsed && (
            <span className="font-bold text-sm text-foreground truncate flex-1">ExamFit Admin</span>
          )}
          {!sidebarCollapsed && <NotificationBell />}
        </div>

        {/* Search trigger */}
        {!sidebarCollapsed && (
          <button
            onClick={() => setCmdOpen(true)}
            className="mx-2 mt-3 mb-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/50 transition-colors min-h-[44px]"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Suchen…</span>
            <kbd className="hidden lg:inline text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
        )}

        {/* Navigation — from SSOT */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {adminNavModules.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path
              || location.pathname.startsWith(item.path + '/')
              || (item.children?.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/')));
            const hasChildren = item.children && item.children.length > 0;

            return (
              <div key={item.path}>
                <Link
                  to={hasChildren ? item.children![0].path : item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-lg text-sm transition-colors min-h-[44px]",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    sidebarCollapsed && "lg:justify-center lg:px-2"
                  )}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {/* On mobile always show labels; on desktop respect collapse */}
                  <span className={cn("flex-1", sidebarCollapsed && "lg:hidden")}>{item.label}</span>
                  {hasChildren && <ChevronDown className={cn("h-3 w-3 transition-transform", sidebarCollapsed && "lg:hidden", isActive && "rotate-180")} />}
                </Link>
                {/* Sub-items */}
                {hasChildren && isActive && (
                  <div className={cn("ml-7 mt-0.5 space-y-0.5", sidebarCollapsed && "lg:hidden")}>
                    {item.children!.map(child => {
                      const childActive = location.pathname === child.path;
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={cn(
                            "block px-3 py-2 lg:py-1.5 rounded-md text-xs transition-colors min-h-[40px] lg:min-h-0 flex items-center",
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
              "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors min-h-[44px]",
              sidebarCollapsed && "lg:justify-center lg:px-2"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className={cn(sidebarCollapsed && "lg:hidden")}>Zurück</span>
          </Link>
          <button
            onClick={() => signOut()}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full min-h-[44px]",
              sidebarCollapsed && "lg:justify-center lg:px-2"
            )}
          >
            <LogOut className="h-4 w-4" />
            <span className={cn(sidebarCollapsed && "lg:hidden")}>Abmelden</span>
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
        "flex-1 min-h-screen transition-all duration-200 flex flex-col",
        sidebarCollapsed ? "lg:ml-16" : "lg:ml-56",
        "pt-14 lg:pt-0"
      )}>
        {/* Global Realtime Status Bar */}
        <GlobalStatusBar />
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
