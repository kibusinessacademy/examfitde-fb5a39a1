import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, Shield, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FailureSummary {
  completed_24h: number;
  protected_stop_24h: number;
  real_failure_24h: number;
  unknown_failure_24h: number;
}

interface FailureRow {
  id: string;
  job_type: string;
  package_id: string | null;
  status: string;
  failure_class: string;
  failure_reason: string;
  last_error: string | null;
  created_at: string;
}

function KPICard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "green" | "yellow" | "red" | "muted";
  icon: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : tone === "yellow"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : tone === "red"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
      : "border-border bg-card text-muted-foreground";

  return (
    <Card className={cn("border", cls)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function JobFailureIntegrityPanel() {
  const {
    data: summary,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["job-failure-summary-24h"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_ops_job_failure_summary_24h")
        .select("*")
        .single();
      if (error) throw error;
      return data as FailureSummary;
    },
    refetchInterval: 60_000,
  });

  const { data: realFailures } = useQuery({
    queryKey: ["job-real-failures-24h"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_ops_job_failure_classification")
        .select(
          "id, job_type, package_id, status, failure_class, failure_reason, last_error, created_at"
        )
        .in("failure_class", ["real_failure", "unknown_failure"])
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as FailureRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: protectedBreakdown } = useQuery({
    queryKey: ["job-protected-breakdown-24h"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_ops_job_failure_classification")
        .select("failure_reason, job_type")
        .eq("failure_class", "protected_stop")
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        );
      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const key = row.failure_reason;
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-muted-foreground">
          Lade Failure Integrity…
        </CardContent>
      </Card>
    );
  }

  const hasReal =
    summary.real_failure_24h > 0 || summary.unknown_failure_24h > 0;
  const overallTone = hasReal
    ? "red"
    : summary.protected_stop_24h > 0
    ? "yellow"
    : "green";

  const reasonLabels: Record<string, string> = {
    stale_lock_recovery: "Stale Lock Recovery",
    duplicate_job_cancelled: "Duplicate Job Cancelled",
    ops_guard_non_building: "OPS Guard: Non-Building",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Job Failure Integrity
          </h2>
          <p className="text-sm text-muted-foreground">
            Trennt Schutz-Events (protected stops) von echten Fehlern.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Aktualisieren
        </Button>
      </div>

      {/* Overall status banner */}
      <Card
        className={cn(
          "border",
          overallTone === "green"
            ? "border-emerald-500/30 bg-emerald-500/10"
            : overallTone === "yellow"
            ? "border-amber-500/30 bg-amber-500/10"
            : "border-rose-500/30 bg-rose-500/10"
        )}
      >
        <CardContent className="py-3 px-4 flex items-center gap-2 text-sm font-medium">
          {overallTone === "green" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : overallTone === "yellow" ? (
            <Shield className="h-4 w-4 text-amber-400" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-400" />
          )}
          <span className="text-foreground">
            {overallTone === "green"
              ? "Pipeline gesund – keine echten Fehler in 24h"
              : overallTone === "yellow"
              ? "Nur Schutz-Events – keine echten Fehler"
              : `${summary.real_failure_24h + summary.unknown_failure_24h} echte Fehler in 24h`}
          </span>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Completed"
          value={summary.completed_24h}
          tone="green"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <KPICard
          label="Protected Stops"
          value={summary.protected_stop_24h}
          tone={summary.protected_stop_24h > 0 ? "yellow" : "muted"}
          icon={<Shield className="h-3.5 w-3.5" />}
        />
        <KPICard
          label="Real Failures"
          value={summary.real_failure_24h}
          tone={summary.real_failure_24h > 0 ? "red" : "muted"}
          icon={<XCircle className="h-3.5 w-3.5" />}
        />
        <KPICard
          label="Unknown"
          value={summary.unknown_failure_24h}
          tone={summary.unknown_failure_24h > 0 ? "red" : "muted"}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Protected stops breakdown */}
      {protectedBreakdown && Object.keys(protectedBreakdown).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              Protected Stops Breakdown
            </h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(protectedBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([reason, count]) => (
                  <Badge
                    key={reason}
                    variant="outline"
                    className="bg-amber-500/10 text-amber-400 border-amber-500/20"
                  >
                    {reasonLabels[reason] || reason}: {count}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real failures drilldown */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">
            Echte / ungeklärte Fehler (24h)
          </h3>
          {!realFailures?.length ? (
            <p className="text-sm text-muted-foreground">
              Keine echten Fehler in den letzten 24 Stunden. ✓
            </p>
          ) : (
            <div className="space-y-2">
              {realFailures.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {row.job_type}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        row.failure_class === "real_failure"
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      )}
                    >
                      {row.failure_reason}
                    </Badge>
                  </div>
                  {row.package_id && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      pkg: {row.package_id.slice(0, 8)}
                    </p>
                  )}
                  <p className="text-xs text-rose-400 mt-1.5 truncate">
                    {row.last_error || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(row.created_at).toLocaleString("de-DE")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
