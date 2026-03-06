import { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {hint ? <div className="mt-2 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
