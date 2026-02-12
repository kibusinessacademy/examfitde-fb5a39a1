import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard, BookOpen, GraduationCap, Brain, Settings,
  LogOut, ChevronLeft, Menu, DollarSign, Activity, Rocket
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navModules = [
  { path: '/admin/dashboard', label: 'Übersicht', icon: LayoutDashboard },
  { path: '/admin/studio', label: 'Kurs-Studio', icon: Rocket },
  { path: '/admin/content', label: 'Inhalte', icon: BookOpen },
  { path: '/admin/curriculum', label: 'Curriculum', icon: GraduationCap },
  { path: '/admin/council', label: 'Councils', icon: Brain },
  { path: '/admin/system', label: 'System', icon: Activity },
  { path: '/admin/finance', label: 'Finanzen', icon: DollarSign },
];

export default function AdminV3Layout() {
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

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

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
        <span className="font-semibold text-sm">Admin</span>
        <div className="w-10" />
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

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navModules.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path
              || location.pathname.startsWith(item.path + '/');
            return (
              <Link
                key={item.path}
                to={item.path}
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
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
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
        <div className="p-4 lg:p-6 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
