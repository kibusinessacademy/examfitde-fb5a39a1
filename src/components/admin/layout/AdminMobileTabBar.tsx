import { NavLink } from "react-router-dom";
import { Activity, ListChecks, Cpu, Package, TrendingUp } from "lucide-react";

const items = [
  { to: "/admin/control-tower", label: "Leitwarte", icon: Activity },
  { to: "/admin/ops/queue", label: "Queue", icon: ListChecks },
  { to: "/admin/providers", label: "AI", icon: Cpu },
  { to: "/admin/packages/risk", label: "Pakete", icon: Package },
  { to: "/admin/revenue", label: "Umsatz", icon: TrendingUp },
];

export function AdminMobileTabBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 px-2 py-2 backdrop-blur lg:hidden">
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-center text-[10px] ${
                isActive
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
