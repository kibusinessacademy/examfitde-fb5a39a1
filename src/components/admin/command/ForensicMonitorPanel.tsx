import { useForensicMonitor, useForensicHeal, type ForensicLayerData, type ForensicHealAction } from "@/hooks/useForensicMonitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Activity, Cpu, FileWarning, BrainCircuit, Layers,
  HeartPulse, Wrench, RefreshCw, ShieldCheck, AlertTriangle, Loader2,
} from "lucide-react";

const LAYER_META: Record<string, { label: string; icon: React.ReactNode; keys: string[] }> = {
  job: { label: "Job Layer", icon: <Cpu className="h-4 w-4" />, keys: ["zombies", "avg_latency_min", "permanent_errors"] },
  step: { label: "Step Layer", icon: <Activity className="h-4 w-4" />, keys: ["stalled", "blocked", "funnel_ratio"] },
  artifact: { label: "Artifact Layer", icon: <FileWarning className="h-4 w-4" />, keys: ["hollow", "artifact_blocked", "real_ratio_pct"] },
  llm: { label: "LLM Layer", icon: <BrainCircuit className="h-4 w-4" />, keys: ["rate_limited", "batch_stuck", "zero_progress_1h"] },
  wip: { label: "WIP Layer", icon: <Layers className="h-4 w-4" />, keys: ["orphans"] },
};

function severityColor(severity: string) {
  if (severity === "P0") return "text-destructive";
  if (severity === "P1") return "text-orange-500";
  if (severity === "P2") return "text-amber-500";
  return "text-emerald-500";
}

function severityBg(severity: string) {
  if (severity === "P0") return "bg-destructive-bg-subtle border-destructive/30";
  if (severity === "P1") return "bg-orange-500/10 border-orange-500/30";
  if (severity === "P2") return "bg-amber-500/10 border-amber-500/30";
  return "bg-emerald-500/10 border-emerald-500/30";
}

function scoreColor(score: number) {
  if (score >= 90) return "text-emerald-500";
  if (score >= 70) return "text-amber-500";
  if (score >= 40) return "text-orange-500";
  return "text-destructive";
}

function progressColor(score: number) {
  if (score >= 90) return "[&>div]:bg-emerald-500";
  if (score >= 70) return "[&>div]:bg-amber-500";
  if (score >= 40) return "[&>div]:bg-orange-500";
  return "[&>div]:bg-destructive";
}

function LayerCard({ layerKey, data }: { layerKey: string; data: ForensicLayerData }) {
  const meta = LAYER_META[layerKey];
  if (!meta) return null;
  const score = data.score ?? 0;

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            {meta.icon}
            {meta.label}
          </div>
          <span className={cn("text-lg font-bold tabular-nums", scoreColor(score))}>{score}</span>
        </div>
        <Progress value={score} className={cn("h-1.5", progressColor(score))} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {meta.keys.map((k) => (
            <div key={k} className="flex justify-between">
              <span className="capitalize">{k.replace(/_/g, " ")}</span>
              <span className="font-medium text-foreground">{String(data[k] ?? 0)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HealResultCard({ actions }: { actions: ForensicHealAction[] }) {
  if (!actions.length) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
      <ShieldCheck className="h-4 w-4 text-emerald-500" />
      Keine Heilungsmaßnahmen nötig – System gesund.
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Wrench className="h-4 w-4 text-primary" />
        Durchgeführte Heilungsmaßnahmen
      </div>
      {actions.map((a, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-xs">
          <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
          <span className="flex-1">{a.detail}</span>
          <Badge variant="secondary" className="text-[10px]">{a.affected} betroffen</Badge>
        </div>
      ))}
    </div>
  );
}

export default function ForensicMonitorPanel() {
  const { data, isLoading, error, refetch } = useForensicMonitor();
  const heal = useForensicHeal();

  const handleHeal = async () => {
    try {
      const result = await heal.mutateAsync();
      const count = result.heal_actions?.reduce((s, a) => s + a.affected, 0) || 0;
      if (count > 0) {
        toast.success(`Healing abgeschlossen: ${count} Elemente repariert`);
      } else {
        toast.info("Keine Reparaturen nötig – System gesund");
      }
    } catch (e) {
      toast.error(`Healing fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive-bg-subtle">
        <CardContent className="p-4 text-sm text-destructive">
          Forensik-Monitor Fehler: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { health_score, severity, layers, duration_ms } = data;

  return (
    <div className="space-y-4">
      {/* Hero Score */}
      <Card className={cn("border", severityBg(severity))}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <HeartPulse className={cn("h-8 w-8", severityColor(severity))} />
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-4xl font-bold tabular-nums", scoreColor(health_score))}>
                    {health_score}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                  <Badge variant="outline" className={cn("text-xs", severityColor(severity))}>
                    {severity}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Tiefenforensische Pipeline-Analyse · {duration_ms}ms · 5 Layer
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Scan
              </Button>
              <Button
                size="sm"
                onClick={handleHeal}
                disabled={heal.isPending}
                className={severity !== "info" ? "bg-orange-600 hover:bg-orange-700" : ""}
              >
                {heal.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Healing…</>
                ) : (
                  <><Wrench className="h-3 w-3 mr-1" /> Auto-Heal</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Layer Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {Object.entries(layers).map(([key, layerData]) => (
          <LayerCard key={key} layerKey={key} data={layerData as ForensicLayerData} />
        ))}
      </div>

      {/* Heal Results */}
      {heal.data?.heal_actions && (
        <Card>
          <CardContent className="p-4">
            <HealResultCard actions={heal.data.heal_actions} />
          </CardContent>
        </Card>
      )}

      {/* Warning for critical */}
      {(severity === "P0" || severity === "P1") && (
        <Card className="border-destructive/30 bg-destructive-bg-subtle">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                {severity === "P0" ? "KRITISCH" : "Warnung"}: Pipeline-Gesundheit unter Schwellwert
              </p>
              <p className="text-muted-foreground mt-1">
                Klicke "Auto-Heal" um automatische Reparaturmaßnahmen durchzuführen (Zombie-Requeue, Lease-Release, Cooldown-Reset, Stalled-Unblock).
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
