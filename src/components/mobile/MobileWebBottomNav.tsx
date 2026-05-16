import { Link, useLocation } from "react-router-dom";
import { Home, BookOpen, GraduationCap, ShoppingBag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNativeApp } from "@/hooks/useNativeApp";

const TABS = [
  { icon: Home, label: "Start", href: "/" },
  { icon: BookOpen, label: "Kurse", href: "/courses" },
  { icon: GraduationCap, label: "Trainer", href: "/exam-trainer" },
  { icon: ShoppingBag, label: "Shop", href: "/shop" },
  { icon: User, label: "Profil", href: "/dashboard" },
];

/**
 * Track 5 — Mobile Web Bottom Nav.
 * Mirrors NativeTabBar for non-native mobile web (PWA + plain mobile browser).
 * Hidden on admin, on desktop, and inside Capacitor (NativeTabBar takes over).
 */
export function MobileWebBottomNav() {
  const isMobile = useIsMobile();
  const { isNative } = useNativeApp();
  const location = useLocation();

  if (!isMobile || isNative) return null;
  if (location.pathname.startsWith("/admin")) return null;
  if (location.pathname.startsWith("/auth")) return null;

  return (
    <nav
      aria-label="Mobile Navigation"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "border-t border-border safe-bottom md:hidden",
      )}
    >
      <div className="flex items-stretch justify-around h-14 px-1">
        {TABS.map((tab) => {
          const active =
            location.pathname === tab.href ||
            (tab.href !== "/" && location.pathname.startsWith(tab.href));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex flex-col items-center justify-center flex-1 px-1 touch-manipulation",
                "transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
              <span className="text-[10px] mt-0.5 font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
