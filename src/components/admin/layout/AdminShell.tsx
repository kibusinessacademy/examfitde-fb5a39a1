import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AdminMobileTabBar } from "./AdminMobileTabBar";
import {
  Activity,
  ListChecks,
  Cpu,
  Package,
  TrendingUp,
} from "lucide-react";

const nav = [
  { to: "/admin/control-tower", label: "Leitwarte", icon: Activity },
  { to: "/admin/ops/queue", label: "Queue", icon: ListChecks },
  { to: "/admin/providers", label: "Provider", icon: Cpu },
  { to: "/admin/packages/risk", label: "Pakete", icon: Package },
  { to: "/admin/revenue", label: "Umsatz", icon: TrendingUp },
];

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-border bg-card lg:block">
          <div className="px-6 py-6 text-xl font-semibold tracking-tight text-foreground">
            ExamFit Leitwarte
          </div>
          <nav className="space-y-1 px-3">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${
                    isActive
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col">
          <div className="flex-1 px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-8">
            {children}
          </div>
          <AdminMobileTabBar />
        </main>
      </div>
    </div>
  );
}
