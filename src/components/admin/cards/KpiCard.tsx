import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-sm transition-all",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {hint ? <div className="mt-2 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
