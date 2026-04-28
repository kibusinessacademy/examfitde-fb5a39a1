import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
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
    <Card
      variant={onClick ? "interactive" : "default"}
      className={cn(
        "rounded-2xl p-4 transition-transform",
        onClick && "hover:ring-2 hover:ring-border-focus/40 active:scale-[0.98]",
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-text-primary">{value}</div>
      {hint ? <div className="mt-2 text-sm text-text-secondary">{hint}</div> : null}
    </Card>
  );
}
