import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { 
  LayoutDashboard, FileText, BookOpen, HelpCircle, Settings, LogOut,
  GraduationCap, Activity, ChevronLeft, ChevronDown, Menu, Bot, 
  ClipboardList, Shield, FileArchive, Database, Factory, ShieldCheck, 
  Smartphone, Crown, Users, ShoppingCart, BarChart3, Globe, Megaphone,
  Wrench, FileBarChart, Brain, Scale, DollarSign, Eye, Cpu, Heart,
  FlaskConical, AlertTriangle, Workflow
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: { path: string; label: string; icon: React.ElementType }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Command Center',
    icon: LayoutDashboard,
    items: [
      { path: '/admin-v2/dashboard', label: 'Executive Overview', icon: LayoutDashboard },
    ],
  },
  {
    label: 'AI Councils',
    icon: Crown,
    items: [
      { path: '/admin-v2/council-control', label: 'Council OS', icon: Crown },
      { path: '/admin-v2/council/education', label: 'Education', icon: GraduationCap },
      { path: '/admin-v2/council/exam', label: 'Exam', icon: ClipboardList },
      { path: '/admin-v2/council/marketing', label: 'Marketing & Sales', icon: Megaphone },
      { path: '/admin-v2/council/product', label: 'Product', icon: Factory },
      { path: '/admin-v2/council/tech', label: 'Tech & Platform', icon: Cpu },
      { path: '/admin-v2/council/legal', label: 'Legal & Compliance', icon: Scale },
      { path: '/admin-v2/council/analytics', label: 'Analytics', icon: BarChart3 },
      { path: '/admin-v2/council/operations', label: 'Operations', icon: Wrench },
    ],
  },
  {
    label: 'Content & Learning',
    icon: BookOpen,
    items: [
      { path: '/admin-v2/curricula', label: 'Curricula & SSOT', icon: FileText },
      { path: '/admin-v2/courses', label: 'Kurse', icon: BookOpen },
      { path: '/admin-v2/course-health', label: 'Kurs-Health', icon: Heart },
      { path: '/admin-v2/course-pipeline', label: 'Kurs-Pipeline', icon: Workflow },
      { path: '/admin-v2/questions', label: 'Prüfungsfragen', icon: HelpCircle },
      { path: '/admin-v2/exam-blueprints', label: 'Blueprints', icon: ClipboardList },
      { path: '/admin-v2/workflows', label: 'Workflow Studio', icon: Workflow },
      { path: '/admin-v2/product-factory', label: 'Produkt-Factory', icon: Factory },
      { path: '/admin-v2/quality-gates', label: 'Quality Gates', icon: ShieldCheck },
      { path: '/admin-v2/exports', label: 'Import / Export', icon: FileArchive },
    ],
  },
  {
    label: 'SEO & Growth',
    icon: Globe,
    items: [
      { path: '/admin-v2/seo', label: 'SEO & Content', icon: Globe },
      { path: '/admin-v2/seo-audit', label: 'SEO Audit', icon: Eye },
      { path: '/admin-v2/marketing', label: 'Marketing Hub', icon: Megaphone },
      { path: '/admin-v2/experiments', label: 'Experiments', icon: FlaskConical },
    ],
  },
  {
    label: 'Users & CRM',
    icon: Users,
    items: [
      { path: '/admin-v2/crm', label: 'CRM & Support', icon: Users },
      { path: '/admin-v2/support-dashboard', label: 'Support Intelligence', icon: Bot },
      { path: '/admin-v2/b2b-support', label: 'B2B Support', icon: DollarSign },
    ],
  },
  {
    label: 'Products & Shop',
    icon: ShoppingCart,
    items: [
      { path: '/admin-v2/kpi-dashboard', label: 'KPI Analytics', icon: BarChart3 },
      { path: '/admin-v2/finance', label: 'Finance & Billing', icon: DollarSign },
    ],
  },
  {
    label: 'Enterprise / B2B',
    icon: Users,
    items: [
      { path: '/admin-v2/enterprise-seats', label: 'Seat-Verwaltung', icon: Users },
    ],
  },
  {
    label: 'System & Tech',
    icon: Wrench,
    items: [
      { path: '/admin-v2/operations', label: 'Operations Center', icon: Activity },
      { path: '/admin-v2/system-health', label: 'Health & Monitoring', icon: Heart },
      { path: '/admin-v2/jobs/dashboard', label: 'Jobs / Queues', icon: Activity },
      { path: '/admin-v2/ai-workers', label: 'AI Workers', icon: Bot },
      { path: '/admin-v2/patches', label: 'Patch Center', icon: FileText },
      { path: '/admin-v2/early-warnings', label: 'Early Warnings', icon: AlertTriangle },
      { path: '/admin-v2/bibb-seeding', label: 'BIBB Seeding', icon: Database },
      { path: '/admin-v2/app-store-builder', label: 'App Store Builder', icon: Smartphone },
    ],
  },
  {
    label: 'Reports & Audits',
    icon: FileBarChart,
    items: [
      { path: '/admin-v2/qc-dashboard', label: 'Quality Reports', icon: Shield },
      { path: '/admin-v2/azav-compliance', label: 'AZAV Compliance', icon: Scale },
      { path: '/admin-v2/audit-exports', label: 'AZAV Exports', icon: ClipboardList },
      { path: '/admin-v2/evidence-packs', label: 'Evidence Packs', icon: FileArchive },
      { path: '/admin-v2/documentation', label: 'Dokumentation', icon: BookOpen },
    ],
  },
];

export default function AdminLayout() {
  const { user, loading, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach(g => {
      const isActive = g.items.some(i => location.pathname.startsWith(i.path));
      initial[g.label] = isActive;
    });
    // Always expand Command Center
    initial['Command Center'] = true;
    return initial;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="orb orb-primary w-96 h-96 -top-48 -left-48 fixed" />
      <div className="orb orb-accent w-80 h-80 bottom-1/4 -right-40 fixed" />

      {/* Mobile header */}
      <header className="lg:hidden glass-subtle sticky top-0 z-50 flex items-center justify-between px-4 h-14">
        <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg gradient-primary">
            <Brain className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display font-semibold text-sm">AI Control Center</span>
        </div>
        <div className="w-10" />
      </header>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 h-full z-50 glass-strong transition-all duration-300",
        "lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarCollapsed ? "w-20" : "w-72"
      )}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={cn("flex items-center gap-3 p-4 pb-2", sidebarCollapsed && "justify-center")}>
            <div className="p-2 rounded-xl gradient-primary shadow-glow-sm flex-shrink-0">
              <Brain className="h-5 w-5 text-primary-foreground" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <span className="font-display font-bold text-foreground text-sm">AI Control Center</span>
                <p className="text-[10px] text-muted-foreground">ExamFit Operations</p>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {navGroups.map((group) => {
              const GroupIcon = group.icon;
              const isExpanded = expandedGroups[group.label] ?? false;
              const hasActiveItem = group.items.some(i => location.pathname.startsWith(i.path));

              return (
                <div key={group.label}>
                  {!sidebarCollapsed ? (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className={cn(
                        "flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors",
                        hasActiveItem ? "text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <GroupIcon className="h-3.5 w-3.5" />
                        <span>{group.label}</span>
                      </div>
                      <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  ) : (
                    <div className="flex justify-center py-1">
                      <GroupIcon className={cn("h-4 w-4", hasActiveItem ? "text-primary" : "text-muted-foreground")} />
                    </div>
                  )}

                  {(isExpanded || sidebarCollapsed) && (
                    <div className={cn("space-y-0.5", !sidebarCollapsed && "ml-2 pl-2 border-l border-border")}>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
                              isActive
                                ? "bg-primary/10 text-primary font-medium border border-primary/20"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                              sidebarCollapsed && "justify-center px-2"
                            )}
                          >
                            <Icon className="h-4 w-4 flex-shrink-0" />
                            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
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
          <div className="p-3 space-y-1 border-t border-border">
            <Link
              to="/"
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              {!sidebarCollapsed && <span>Zurück zur Seite</span>}
            </Link>
            <button
              onClick={() => signOut()}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all w-full",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <LogOut className="h-4 w-4" />
              {!sidebarCollapsed && <span>Abmelden</span>}
            </button>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
            >
              <ChevronLeft className={cn("h-4 w-4 transition-transform", sidebarCollapsed && "rotate-180")} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className={cn(
        "min-h-screen transition-all duration-300 relative z-10",
        sidebarCollapsed ? "lg:ml-20" : "lg:ml-72"
      )}>
        <div className="p-4 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
