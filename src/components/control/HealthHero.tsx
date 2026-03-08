import { cn } from "@/lib/utils";

interface HealthHeroProps {
  healthScore?: number;
  status?: string;
  openAlerts?: number;
  blendedRoi?: number;
}

function statusColor(status: string) {
  if (status === "healthy") return "text-emerald-500";
  if (status === "warning") return "text-amber-500";
  if (status === "degraded") return "text-orange-500";
  if (status === "critical") return "text-destructive";
  return "text-muted-foreground";
}

export default function HealthHero({
  healthScore = 0,
  status = "unknown",
  openAlerts = 0,
  blendedRoi = 0,
}: HealthHeroProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-sm text-muted-foreground">Systemstatus</div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-4xl font-bold tracking-tight">{healthScore}</span>
        <span className={cn("text-sm font-semibold uppercase tracking-wide", statusColor(status))}>{status}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Offene Alerts: <strong className="text-foreground">{openAlerts}</strong></span>
        <span>Blended ROI: <strong className="text-foreground">{Number(blendedRoi || 0).toFixed(2)}</strong></span>
      </div>
    </div>
  );
}
