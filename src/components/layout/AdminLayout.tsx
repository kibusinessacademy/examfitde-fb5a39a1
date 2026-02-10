import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { 
  LayoutDashboard, 
  FileText, 
  BookOpen, 
  HelpCircle, 
  Settings,
  LogOut,
  GraduationCap,
  Activity,
  ChevronLeft,
  Menu,
  Bot,
  ClipboardList,
  Shield,
  FileArchive,
  Database,
  Factory,
  ShieldCheck,
  Smartphone,
  Crown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/admin-v2/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin-v2/council-control', label: 'Council OS', icon: Crown },
  { path: '/admin-v2/kpi-dashboard', label: 'KPI Analytics', icon: Activity },
  { path: '/admin-v2/curricula', label: 'Curricula', icon: FileText },
  { path: '/admin-v2/product-factory', label: 'Produkt-Factory', icon: Factory },
  { path: '/admin-v2/quality-gates', label: 'Quality Gates', icon: ShieldCheck },
  { path: '/admin-v2/courses', label: 'Kurse', icon: BookOpen },
  { path: '/admin-v2/questions', label: 'Prüfungsfragen', icon: HelpCircle },
  { path: '/admin-v2/exam-blueprints', label: 'Blueprints', icon: ClipboardList },
  { path: '/admin-v2/marketing', label: 'Marketing', icon: Shield },
  { path: '/admin-v2/crm', label: 'CRM & Support', icon: Bot },
  { path: '/admin-v2/seo', label: 'SEO & Content', icon: FileArchive },
  { path: '/admin-v2/seo-audit', label: 'SEO Audit', icon: Shield },
  { path: '/admin-v2/jobs/dashboard', label: 'Jobs', icon: Activity },
  { path: '/admin-v2/ai-workers', label: 'AI Workers', icon: Bot },
  { path: '/admin-v2/system-health', label: 'System Health', icon: Shield },
  { path: '/admin-v2/azav-compliance', label: 'AZAV Compliance', icon: Shield },
  { path: '/admin-v2/audit-exports', label: 'AZAV Exports', icon: ClipboardList },
  { path: '/admin-v2/evidence-packs', label: 'Evidence Packs', icon: FileArchive },
  { path: '/admin-v2/bibb-seeding', label: 'BIBB Seeding', icon: Database },
  { path: '/admin-v2/exports', label: 'Kurs-Exporte', icon: FileArchive },
  { path: '/admin-v2/qc-dashboard', label: 'QC Snapshot API', icon: Shield },
  { path: '/admin-v2/app-store-builder', label: 'App Store Builder', icon: Smartphone },
  { path: '/admin-v2/documentation', label: 'Dokumentation', icon: BookOpen },
  { path: '/admin-v2/settings', label: 'Einstellungen', icon: Settings },
];

export default function AdminLayout() {
  const { user, loading, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
      <div className="orb orb-accent w-80 h-80 bottom-1/4 -right-40 fixed" />

      {/* Mobile header */}
      <header className="lg:hidden glass-subtle sticky top-0 z-50 flex items-center justify-between px-4 h-14">
        <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg gradient-primary">
            <GraduationCap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display font-semibold text-sm">Admin</span>
        </div>
        <div className="w-10" />
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full z-50 glass-strong transition-all duration-300",
        "lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarCollapsed ? "w-20" : "w-64"
      )}>
        <div className="flex flex-col h-full p-4">
          {/* Logo */}
          <div className={cn(
            "flex items-center gap-3 mb-8",
            sidebarCollapsed && "justify-center"
          )}>
            <div className="p-2 rounded-xl gradient-primary shadow-glow-sm flex-shrink-0">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-display font-semibold text-foreground">
                Admin Panel
              </span>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                    isActive 
                      ? "glass-card border-primary/30 text-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Bottom actions */}
          <div className="space-y-2 pt-4 border-t border-border">
            <Link
              to="/"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <ChevronLeft className="h-5 w-5" />
              {!sidebarCollapsed && <span>Zurück zur Seite</span>}
            </Link>
            
            <button
              onClick={handleSignOut}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all w-full",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <LogOut className="h-5 w-5" />
              {!sidebarCollapsed && <span>Abmelden</span>}
            </button>
          </div>

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex items-center justify-center mt-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
          >
            <ChevronLeft className={cn(
              "h-4 w-4 transition-transform",
              sidebarCollapsed && "rotate-180"
            )} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn(
        "min-h-screen transition-all duration-300 relative z-10",
        "lg:ml-64",
        sidebarCollapsed && "lg:ml-20"
      )}>
        <div className="p-4 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
