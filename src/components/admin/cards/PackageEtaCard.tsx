/**
 * PackageEtaCard — Step-weighted ETA, publish priority, and health signals
 * for all building packages. Data from v_building_package_eta (SSOT).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Zap, AlertTriangle, TrendingUp, Activity, Skull, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface EtaRow {
  package_id: string;
  title: string;
  status: string;
  priority: number | null;
  build_progress: number;
  total_steps: number;
  done_steps: number;
  running_steps: number;
  blocked_steps: number;
  failed_steps: number;
  weighted_progress_pct: number;
  eta_hours_sequential: number;
  eta_hours_parallel: number;
  bottleneck_step: string | null;
  bottleneck_hours: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  completions_24h: number;
  hours_since_last_completion: number;
  health_signal: string;
  publish_priority_score: number;
}

function usePackageEta() {
  return useQuery({
    queryKey: ["admin", "package-eta"],
    queryFn: async (): Promise<EtaRow[]> => {
      const { data, error } = await (supabase as any)
        .from("v_building_package_eta")
        .select("*")
        .order("publish_priority_score", { ascending: false });
      if (error) throw error;
      return data as EtaRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function formatEta(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

const HEALTH_CONFIG: Record<string, { icon: typeof Activity; color: string; label: string }> = {
  healthy: { icon: Activity, color: "text-emerald-500", label: "Healthy" },
  starvation: { icon: Pause, color: "text-amber-500", label: "Starvation" },
  no_active_work: { icon: Skull, color: "text-rose-500", label: "Kein aktiver Job" },
  failed_steps: { icon: AlertTriangle, color: "text-destructive", label: "Failed Steps" },
  blocked_steps: { icon: AlertTriangle, color: "text-orange-500", label: "Blocked" },
};

function HealthBadge({ signal }: { signal: string }) {
  const cfg = HEALTH_CONFIG[signal] ?? HEALTH_CONFIG.healthy;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium", cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function WeightedBar({ weightedPct, storedPct }: { weightedPct: number; storedPct: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary/25 transition-all duration-500"
            style={{ width: `${Math.min(storedPct, 100)}%` }}
          />
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${Math.min(weightedPct, 100)}%` }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p>Gewichtet: {weightedPct}% · Steps: {storedPct}%</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function PackageEtaCard() {
  const { data, isLoading } = usePackageEta();

  if (isLoading || !data) return null;

  const publishReady = data.filter(r => r.weighted_progress_pct >= 60);
  const anomalies = data.filter(r => r.health_signal !== "healthy");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-primary" />
            Step-Weighted ETA
            <Badge variant="secondary" className="text-[10px]">
              {data.length} building
            </Badge>
          </CardTitle>
          <div className="flex gap-2">
            {publishReady.length > 0 && (
              <Badge className="bg-emerald-500/15 text-emerald-600 text-[10px] border-0">
                <TrendingUp className="h-3 w-3 mr-0.5" />
                {publishReady.length} publish-nah
              </Badge>
            )}
            {anomalies.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {anomalies.length} anomal
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
          {data.map((row) => (
            <div key={row.package_id} className="space-y-1 group">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <HealthBadge signal={row.health_signal} />
                  <span className="text-xs font-medium truncate" title={row.title}>
                    {row.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground tabular-nums">
                        P{row.priority ?? "–"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Priorität</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="tabular-nums font-semibold w-12 text-right">
                        {formatEta(row.eta_hours_parallel)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      <p>ETA parallel: {formatEta(row.eta_hours_parallel)}</p>
                      <p>ETA sequenziell: {formatEta(row.eta_hours_sequential)}</p>
                      <p>Bottleneck: {row.bottleneck_step} ({row.bottleneck_hours}h)</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(
                        "tabular-nums font-bold w-8 text-right",
                        row.publish_priority_score >= 70 ? "text-emerald-600" :
                        row.publish_priority_score >= 40 ? "text-foreground" :
                        "text-muted-foreground"
                      )}>
                        {row.publish_priority_score}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      Publish-Priority-Score (0–100)
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <WeightedBar weightedPct={row.weighted_progress_pct} storedPct={row.build_progress} />
                <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-right shrink-0">
                  {row.weighted_progress_pct}%
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <span>{row.done_steps}/{row.total_steps} Steps</span>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Zap className="h-2.5 w-2.5" />{row.completions_24h}/24h
                </span>
                {row.jobs_processing > 0 && (
                  <>
                    <span>·</span>
                    <span>{row.jobs_processing} processing</span>
                  </>
                )}
                {row.bottleneck_step && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-[120px]">⏳ {row.bottleneck_step}</span>
                  </>
                )}
              </div>
            </div>
          ))}
          {data.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Keine Building-Pakete</p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground border-t pt-2">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-full bg-primary" /> Gewichtet
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-full bg-primary/25" /> Step-basiert
          </span>
          <span>ETA = P75-Dauer × offene Steps × 0.45 (Parallelität)</span>
        </div>
      </CardContent>
    </Card>
  );
}
