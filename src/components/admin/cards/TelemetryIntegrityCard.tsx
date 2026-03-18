/**
 * TelemetryIntegrityCard — Unified telemetry + drift + artifact integrity panel.
 * Shows per-package: content_versions_24h, llm_cost_events_24h, ratio, gap flag,
 * stored/real progress, drift severity, missing artifacts, last activity.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, RefreshCw, Wrench, ShieldCheck,
  ArrowRight, Radio, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

interface TelemetryRow {
  package_id: string;
  title: string;
  status: string;
  stored_progress: number;
  real_progress: number;
  drift: number;
  content_versions_24h: number;
  llm_cost_events_24h: number;
  telemetry_ratio: number;
  logging_gap: boolean;
  drift_severity: "ok" | "warning" | "critical";
  content_pct: number;
  exam_pct: number;
  minicheck_pct: number;
  handbook_pct: number;
  steps_done_pct: number;
  active_jobs: number;
  pending_jobs: number;
  last_content_at: string | null;
  last_llm_at: string | null;
  last_job_at: string | null;
  last_any_activity: string | null;
  missing_steps: string[] | null;
  llm_breakdown: Array<{ provider: string; model: string; job_type: string; events_24h: number }> | null;
}

interface TelemetrySummary {
  total: number;
  logging_gaps: number;
  critical_drift: number;
  warning_drift: number;
  healthy: number;
}

function useIntegrity() {
  return useQuery({
    queryKey: ["admin", "telemetry-integrity"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-control-tower", {
        body: { action: "telemetry_integrity" },
      });
      if (error) throw error;
      return data as { packages: TelemetryRow[]; summary: TelemetrySummary };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function relativeTime(iso: string | null): string {
  if (!iso) return "–";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "jetzt";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function SeverityDot({ severity }: { severity: string }) {
  return (
    <span className={cn(
      "inline-block h-2 w-2 rounded-full shrink-0",
      severity === "critical" ? "bg-destructive" :
      severity === "warning" ? "bg-amber-500" :
      "bg-emerald-500",
    )} />
  );
}

function ArtifactBar({ label, pct }: { label: string; pct: number }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground w-3 text-right">{label}</span>
            <div className="h-1.5 w-10 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full",
                  pct >= 90 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : pct > 0 ? "bg-orange-500" : "bg-muted-foreground/10"
                )}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{label}: {pct}%</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RecoveryButton({ packageId, type, label, icon: Icon }: {
  packageId: string; type: string; label: string; icon: typeof Wrench;
}) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-control-tower", {
        body: { action: "recovery_action", recovery_type: type, package_id: packageId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${label}: OK`, { description: JSON.stringify(data.result).slice(0, 120) });
    } catch (e: any) {
      toast.error(`${label} fehlgeschlagen`, { description: e.message });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={run} disabled={loading}>
      <Icon className={cn("h-3 w-3 mr-0.5", loading && "animate-spin")} />
      {label}
    </Button>
  );
}

export function TelemetryIntegrityCard() {
  const { data, isLoading, refetch } = useIntegrity();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading || !data) return null;

  const { packages, summary } = data;

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Eye className="h-4 w-4 text-primary" />
            Telemetry & Drift Integrity
          </CardTitle>
          <div className="flex items-center gap-2">
            {summary.logging_gaps > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <Radio className="h-3 w-3 mr-0.5" /> {summary.logging_gaps} Logging-Gap{summary.logging_gaps > 1 ? "s" : ""}
              </Badge>
            )}
            {summary.critical_drift > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-0.5" /> {summary.critical_drift} Drift
              </Badge>
            )}
            {summary.logging_gaps === 0 && summary.critical_drift === 0 && (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                <ShieldCheck className="h-3 w-3 mr-0.5" /> Clean
              </Badge>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary bar */}
        <div className="flex gap-4 mb-4 text-xs text-muted-foreground">
          <span>{summary.total} Pakete</span>
          <span className="text-emerald-600">{summary.healthy} gesund</span>
          <span className="text-amber-600">{summary.warning_drift} Drift-Warning</span>
          <span className="text-destructive">{summary.critical_drift} Drift-Critical</span>
          <span className="text-destructive">{summary.logging_gaps} Log-Gaps</span>
        </div>

        {/* Package list */}
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {/* Header */}
          <div className="grid grid-cols-12 gap-1 text-[10px] text-muted-foreground font-medium px-2 py-1 border-b border-border/50">
            <span className="col-span-3">Paket</span>
            <span className="col-span-2 text-center">Progress</span>
            <span className="col-span-2 text-center">Telemetrie 24h</span>
            <span className="col-span-2 text-center">Artefakte</span>
            <span className="col-span-1 text-center">Jobs</span>
            <span className="col-span-1 text-center">Letzte</span>
            <span className="col-span-1 text-center">Actions</span>
          </div>

          {packages.map((row) => (
            <div key={row.package_id}>
              <div
                className={cn(
                  "grid grid-cols-12 gap-1 items-center px-2 py-1.5 rounded text-xs hover:bg-muted/50 cursor-pointer transition-colors",
                  row.logging_gap && "bg-destructive/5",
                  row.drift_severity === "critical" && "bg-amber-500/5",
                )}
                onClick={() => setExpanded(expanded === row.package_id ? null : row.package_id)}
              >
                {/* Title + status */}
                <div className="col-span-3 flex items-center gap-1.5 min-w-0">
                  <SeverityDot severity={row.drift_severity} />
                  <span className="truncate font-medium" title={row.title}>{row.title}</span>
                  {row.logging_gap && <Radio className="h-3 w-3 text-destructive shrink-0" />}
                </div>

                {/* Progress */}
                <div className="col-span-2 flex items-center justify-center gap-1">
                  <span className="text-muted-foreground">{row.stored_progress}%</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                  <span className={cn(
                    "font-semibold",
                    row.drift_severity === "critical" ? "text-destructive" :
                    row.drift_severity === "warning" ? "text-amber-600" : "text-foreground",
                  )}>
                    {row.real_progress}%
                  </span>
                </div>

                {/* Telemetry */}
                <div className="col-span-2 text-center">
                  <span className="text-muted-foreground">{row.content_versions_24h}cv</span>
                  <span className="mx-0.5 text-muted-foreground/50">/</span>
                  <span className={row.logging_gap ? "text-destructive font-semibold" : "text-muted-foreground"}>
                    {row.llm_cost_events_24h}llm
                  </span>
                </div>

                {/* Artifacts */}
                <div className="col-span-2 flex flex-col gap-0.5">
                  <div className="flex gap-1.5 justify-center">
                    <ArtifactBar label="C" pct={row.content_pct} />
                    <ArtifactBar label="E" pct={row.exam_pct} />
                  </div>
                  <div className="flex gap-1.5 justify-center">
                    <ArtifactBar label="M" pct={row.minicheck_pct} />
                    <ArtifactBar label="H" pct={row.handbook_pct} />
                  </div>
                </div>

                {/* Jobs */}
                <div className="col-span-1 text-center">
                  {row.active_jobs > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1">
                      <Activity className="h-2.5 w-2.5 mr-0.5" />{row.active_jobs}
                    </Badge>
                  )}
                  {row.pending_jobs > 0 && (
                    <span className="text-[9px] text-muted-foreground ml-0.5">+{row.pending_jobs}p</span>
                  )}
                  {row.active_jobs === 0 && row.pending_jobs === 0 && (
                    <span className="text-[9px] text-muted-foreground">–</span>
                  )}
                </div>

                {/* Last activity */}
                <div className="col-span-1 text-center text-[10px] text-muted-foreground">
                  {relativeTime(row.last_any_activity)}
                </div>

                {/* Quick actions */}
                <div className="col-span-1 flex justify-center">
                  <RecoveryButton
                    packageId={row.package_id}
                    type="reconcile_progress"
                    label="Sync"
                    icon={RefreshCw}
                  />
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === row.package_id && (
                <div className="mx-2 mb-2 p-3 rounded-md bg-muted/30 border border-border/50 text-xs space-y-2">
                  <div className="flex gap-4 flex-wrap">
                    <div>
                      <span className="text-muted-foreground">Telemetrie-Ratio:</span>{" "}
                      <span className={row.telemetry_ratio < 0 ? "text-destructive font-bold" : ""}>
                        {row.telemetry_ratio < 0 ? "∞ (kein LLM-Log)" : row.telemetry_ratio}
                      </span>
                    </div>
                    <div><span className="text-muted-foreground">Steps Done:</span> {row.steps_done_pct}%</div>
                    <div><span className="text-muted-foreground">Drift:</span> {row.drift > 0 ? "+" : ""}{row.drift}pp</div>
                    <div><span className="text-muted-foreground">Content:</span> {relativeTime(row.last_content_at)}</div>
                    <div><span className="text-muted-foreground">LLM:</span> {relativeTime(row.last_llm_at)}</div>
                    <div><span className="text-muted-foreground">Job:</span> {relativeTime(row.last_job_at)}</div>
                  </div>

                  {row.missing_steps && row.missing_steps.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Offene Steps:</span>{" "}
                      {row.missing_steps.map((s) => (
                        <Badge key={s} variant="outline" className="text-[9px] mr-1 mb-0.5">{s}</Badge>
                      ))}
                    </div>
                  )}

                  {row.llm_breakdown && row.llm_breakdown.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">LLM Breakdown:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {row.llm_breakdown.map((b, i) => (
                          <Badge key={i} variant="secondary" className="text-[9px]">
                            {b.provider}/{b.model} · {b.job_type} · {b.events_24h}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-1 pt-1 border-t border-border/30">
                    <RecoveryButton packageId={row.package_id} type="repair_finalize" label="Finalize reparieren" icon={Wrench} />
                    <RecoveryButton packageId={row.package_id} type="clear_guards" label="Guards bereinigen" icon={ShieldCheck} />
                    <RecoveryButton packageId={row.package_id} type="reconcile_progress" label="Progress Sync" icon={RefreshCw} />
                  </div>
                </div>
              )}
            </div>
          ))}

          {packages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Keine aktiven Pakete</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
