/**
 * PublishWorkflowStatusCard
 * ─────────────────────────
 * Drift-Detektor für den Publish-Workflow. Zeigt parallel:
 *   • publish-ready   → Council green, kein Blocker, noch nicht published
 *   • processing      → aktiv laufende package_auto_publish-Jobs
 *   • STALE_REAP      → terminale Reaper-Verdicts (kein Retry sinnvoll)
 *
 * Damit werden Drift (Smart-NBA zeigt 67 ready, real laufen aber nur 31) und
 * Fehlklassifikationen (terminale Failures als „transient" gezählt) sofort
 * sichtbar — ein Blick statt drei Tabs.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, Cpu, Skull, AlertTriangle } from "lucide-react";
import { useAdminQueueSSOT, isTerminalFailure } from "@/hooks/useAdminQueueSSOT";
import { usePublishReadiness } from "@/hooks/usePublishReadiness";
import { cn } from "@/lib/utils";

interface Tile {
  id: string;
  label: string;
  count: number;
  detail: string;
  tone: "ok" | "info" | "warn" | "danger";
  icon: React.ComponentType<{ className?: string }>;
}

const TONE_CLASS: Record<Tile["tone"], string> = {
  ok: "border-success/30 bg-success-bg-subtle",
  info: "border-primary/30 bg-primary/5",
  warn: "border-warning/30 bg-warning-bg-subtle",
  danger: "border-destructive/30 bg-destructive-bg-subtle",
};

export function PublishWorkflowStatusCard() {
  const { data: readiness, isLoading: readyL } = usePublishReadiness();
  const { data: jobs, isLoading: jobL } = useAdminQueueSSOT();

  const tiles = useMemo<Tile[]>(() => {
    if (!readiness || !jobs) return [];

    const readyToPublish = readiness.filter(
      (r: any) =>
        (r.effective_publish_ready ?? r.publish_ready) === true &&
        r.is_published !== true &&
        r.package_status !== "published",
    );

    const processingPublish = jobs.filter(
      (j) =>
        j.job_type === "package_auto_publish" &&
        ["processing", "running"].includes(j.job_status),
    );

    const staleReap = jobs.filter(
      (j) => j.job_status === "failed" && isTerminalFailure(j.last_error),
    );

    const driftDelta = Math.max(0, readyToPublish.length - processingPublish.length);

    return [
      {
        id: "ready",
        label: "Publish-Ready",
        count: readyToPublish.length,
        detail: "Council green, kein Blocker — noch nicht published",
        tone: readyToPublish.length > 0 ? "info" : "ok",
        icon: Rocket,
      },
      {
        id: "processing",
        label: "Processing",
        count: processingPublish.length,
        detail:
          driftDelta > 5
            ? `Drift: ${driftDelta} Pakete bereit, aber kein Job läuft`
            : "package_auto_publish-Jobs aktiv",
        tone: driftDelta > 5 ? "warn" : "info",
        icon: Cpu,
      },
      {
        id: "stale_reap",
        label: "STALE_REAP / Terminal",
        count: staleReap.length,
        detail:
          staleReap.length > 0
            ? "Hart gefailed durch Guards — KEIN Bulk-Requeue (würde übersprungen)"
            : "Keine terminalen Verdicts",
        tone: staleReap.length >= 50 ? "danger" : staleReap.length > 0 ? "warn" : "ok",
        icon: Skull,
      },
    ];
  }, [readiness, jobs]);

  if (readyL || jobL) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </Card>
    );
  }

  const hasDrift = tiles.find((t) => t.id === "processing")?.tone === "warn";
  const hasTerminal = (tiles.find((t) => t.id === "stale_reap")?.count ?? 0) > 0;

  return (
    <Card className="p-4 space-y-3" data-testid="publish-workflow-status">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground">Publish-Workflow Status</h2>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
          Drift-Detektor
        </Badge>
        {(hasDrift || hasTerminal) && (
          <Badge
            variant="outline"
            className="text-[10px] h-4 px-1.5 bg-warning-bg-subtle text-warning border-warning/30 inline-flex items-center gap-1"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Drift erkannt
          </Badge>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <div
            key={t.id}
            className={cn("rounded-xl border p-3 space-y-1.5", TONE_CLASS[t.tone])}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </div>
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {t.count.toLocaleString("de-DE")}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{t.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
