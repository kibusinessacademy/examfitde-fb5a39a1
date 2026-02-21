import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ActiveCourseProvider } from '@/contexts/ActiveCourseContext';
import ActiveCourseBar from '@/components/admin/ActiveCourseBar';
import GlobalStatusBar from '@/components/admin/GlobalStatusBar';
import { Menu, Search } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import CommandPalette from '@/components/admin/CommandPalette';
import NotificationBell from '@/components/admin/NotificationBell';
import AdminSidebar from '@/components/admin/AdminSidebar';

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
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Body scroll lock when mobile drawer open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
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
      <AdminSidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onCollapse={setSidebarCollapsed}
        onMobileClose={() => setMobileOpen(false)}
        onCmdOpen={() => setCmdOpen(true)}
      />

      {/* Main */}
      <main className={cn(
        "flex-1 min-h-screen transition-all duration-200 flex flex-col",
        sidebarCollapsed ? "lg:ml-16" : "lg:ml-56",
        "pt-14 lg:pt-0"
      )}>
        <GlobalStatusBar />
        <ActiveCourseProvider>
          <ActiveCourseBar />
          {/* Breadcrumbs */}
           <div className="px-4 lg:px-6 pt-4 lg:pt-5">
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
              <Link to="/admin/command" className="hover:text-foreground transition-colors font-medium">Admin</Link>
              {pathParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className="text-border">/</span>
                  {i === pathParts.length - 1 ? (
                    <span className="text-foreground font-semibold bg-primary/5 px-2 py-0.5 rounded-md">{breadcrumbLabels[part] || part}</span>
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
