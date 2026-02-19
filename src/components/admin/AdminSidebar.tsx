import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPins, useAdminRecents, useNavBadges } from '@/hooks/useAdminSidebar';
import { adminNavModules } from '@/admin/adminNav';
import { cn } from '@/lib/utils';
import NotificationBell from '@/components/admin/NotificationBell';
import {
  LogOut, ChevronLeft, ChevronDown, Search, Brain, Pin, Clock, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useEffect } from 'react';

interface Props {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: (v: boolean) => void;
  onMobileClose: () => void;
  onCmdOpen: () => void;
}

export default function AdminSidebar({ collapsed, mobileOpen, onCollapse, onMobileClose, onCmdOpen }: Props) {
  const { signOut } = useAuth();
  const location = useLocation();
  const { pins, removePin } = useAdminPins();
  const { recents, trackVisit } = useAdminRecents();
  const badges = useNavBadges();

  // Track page visits
  const breadcrumbLabels: Record<string, string> = {
    command: 'Leitstelle', studio: 'Factory', quality: 'Qualität',
    ops: 'Ops', business: 'Finanzen', growth: 'Wachstum', scale: 'Skalierung',
    content: 'Content & SEO', crm: 'CRM', support: 'Support',
    pipeline: 'Pipeline Live', handbook: 'Handbuch',
  };
  useEffect(() => {
    const parts = location.pathname.replace('/admin/', '').split('/').filter(Boolean);
    const label = parts.map(p => breadcrumbLabels[p] || p).join(' / ');
    if (label) trackVisit(label);
  }, [location.pathname]);

  const getBadgeCount = (key?: string) => {
    if (!key) return 0;
    return (badges as any)[key] || 0;
  };

  return (
    <aside className={cn(
      "fixed left-0 z-50 bg-card border-r border-border transition-all duration-200 flex flex-col",
      "lg:top-0 lg:h-full lg:translate-x-0",
      "top-14 h-[calc(100vh-3.5rem)]",
      mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      collapsed ? "lg:w-16 w-[85vw] max-w-[320px]" : "lg:w-56 w-[85vw] max-w-[320px]"
    )}>
      {/* Logo */}
      <div className={cn(
        "hidden lg:flex items-center gap-2 h-14 px-4 border-b border-border shrink-0",
        collapsed && "justify-center px-2"
      )}>
        <div className="p-1.5 rounded-lg bg-primary shrink-0">
          <Brain className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && <span className="font-bold text-sm text-foreground truncate flex-1">ExamFit Admin</span>}
        {!collapsed && <NotificationBell />}
      </div>

      {/* Search trigger */}
      {!collapsed && (
        <button
          onClick={onCmdOpen}
          className="mx-2 mt-3 mb-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/50 transition-colors min-h-[44px]"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Suchen…</span>
          <kbd className="hidden lg:inline text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
        </button>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {/* Pinned */}
        {!collapsed && pins.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <Pin className="h-3 w-3" /> Angepinnt
            </div>
            {pins.map(pin => (
              <div key={pin.id} className="group flex items-center">
                <Link
                  to={pin.url}
                  className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 truncate"
                >
                  {pin.label}
                </Link>
                <button
                  onClick={() => removePin(pin.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recents */}
        {!collapsed && recents.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <Clock className="h-3 w-3" /> Zuletzt
            </div>
            {recents.slice(0, 4).map(r => (
              <Link
                key={r.id}
                to={r.url}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 truncate"
              >
                {r.label}
              </Link>
            ))}
          </div>
        )}

        {/* Separator */}
        {!collapsed && (pins.length > 0 || recents.length > 0) && (
          <div className="border-t border-border my-2" />
        )}

        {/* Main Nav */}
        {adminNavModules.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path
            || location.pathname.startsWith(item.path + '/')
            || (item.children?.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/')));
          const hasChildren = item.children && item.children.length > 0;
          const badgeCount = getBadgeCount(item.badgeKey);

          return (
            <div key={item.path}>
              <Link
                to={hasChildren ? item.children![0].path : item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-lg text-sm transition-colors min-h-[44px]",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  collapsed && "lg:justify-center lg:px-2"
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                <span className={cn("flex-1", collapsed && "lg:hidden")}>{item.label}</span>
                {badgeCount > 0 && !collapsed && (
                  <Badge variant="destructive" className="text-[10px] h-5 min-w-[20px] px-1 justify-center">
                    {badgeCount}
                  </Badge>
                )}
                {hasChildren && <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed && "lg:hidden", isActive && "rotate-180")} />}
              </Link>
              {hasChildren && isActive && (
                <div className={cn("ml-7 mt-0.5 space-y-0.5", collapsed && "lg:hidden")}>
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
            collapsed && "lg:justify-center lg:px-2"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className={cn(collapsed && "lg:hidden")}>Zurück</span>
        </Link>
        <button
          onClick={() => signOut()}
          className={cn(
            "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full min-h-[44px]",
            collapsed && "lg:justify-center lg:px-2"
          )}
        >
          <LogOut className="h-4 w-4" />
          <span className={cn(collapsed && "lg:hidden")}>Abmelden</span>
        </button>
        <button
          onClick={() => onCollapse(!collapsed)}
          className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
    </aside>
  );
}
