/**
 * IntegrityHealthBanner — Cockpit-Komponente
 *
 * Zeigt aggregierte Diagnose der Integrity-Failures, die im Cockpit als
 * generisches "INTEGRITY_FAILED" auftauchen. Macht transparent, ob Pakete
 * noch nie geprüft wurden (häufigster Fall) oder echte Hard-Fails haben.
 *
 * Datenquelle: RPC `admin_get_integrity_failure_summary`
 * Aktion: RPC `enqueue_integrity_rechecks` (Cap 250) für manuellen Backfill.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, RefreshCw, CheckCircle2, Loader2, FileQuestion, History } from "lucide-react";
import { toast } from "sonner";

interface IntegritySummary {
  generated_at: string;
  current_report_version: number;
  total_failed: number;
  never_checked: number;
  with_report: number;
  stale_version: number;
  top_hard_fail_reasons: Record<string, number>;
}

export function IntegrityHealthBanner() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "integrity-failure-summary"],
    queryFn: async (): Promise<IntegritySummary> => {
      const { data, error } = await supabase.rpc(
        "admin_get_integrity_failure_summary" as any,
      );
      if (error) throw error;
      return data as unknown as IntegritySummary;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const recheck = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "enqueue_integrity_rechecks" as any,
        { p_cap: 250, p_reason: "manual_cockpit_trigger" },
      );
      if (error) throw error;
      return data as { enqueued: number; candidates: number };
    },
    onSuccess: (r) => {
      toast.success(
        `Recheck angestoßen: ${r?.enqueued ?? 0} Jobs neu eingereiht (von ${r?.candidates ?? 0} Kandidaten)`,
      );
      qc.invalidateQueries({ queryKey: ["admin", "integrity-failure-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Recheck fehlgeschlagen"),
  });

  if (isLoading) {
    return (
      <Card className="p-3 animate-pulse bg-muted/40 h-20" />
    );
  }
  if (error || !data) return null;

  // Healthy state — keine Failures
  if (data.total_failed === 0) {
    return (
      <Card className="p-3 border-success/40 bg-success/5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="font-medium">Integrity-Check: Alle Pakete geprüft & valide</span>
          <Badge variant="outline" className="text-[10px] ml-auto">v{data.current_report_version}</Badge>
        </div>
      </Card>
    );
  }

  const topReasons = Object.entries(data.top_hard_fail_reasons ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const tone = data.never_checked > 0 ? "warning" : "destructive";

  return (
    <Card
      className={
        tone === "warning"
          ? "p-4 border-warning/50 bg-warning/5"
          : "p-4 border-destructive/50 bg-destructive/5"
      }
    >
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={
              tone === "warning"
                ? "p-2 rounded-md bg-warning/10 border border-warning/30"
                : "p-2 rounded-md bg-destructive/10 border border-destructive/30"
            }
          >
            <ShieldAlert
              className={
                tone === "warning"
                  ? "h-4 w-4 text-warning"
                  : "h-4 w-4 text-destructive"
              }
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">
                Integrity-Blocker — {data.total_failed} Pakete
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">
                Report v{data.current_report_version}
              </Badge>
            </div>

            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <Stat
                icon={<FileQuestion className="h-3 w-3" />}
                label="Nie geprüft"
                value={data.never_checked}
                tone={data.never_checked > 0 ? "warning" : "muted"}
              />
              <Stat
                icon={<ShieldAlert className="h-3 w-3" />}
                label="Echte Hard-Fails"
                value={data.with_report}
                tone={data.with_report > 0 ? "destructive" : "muted"}
              />
              <Stat
                icon={<History className="h-3 w-3" />}
                label="Stale (alte Version)"
                value={data.stale_version}
                tone={data.stale_version > 0 ? "warning" : "muted"}
              />
            </div>

            {topReasons.length > 0 && (
              <div className="mt-3">
                <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground mb-1">
                  Top Hard-Fail-Reasons
                </div>
                <div className="flex flex-wrap gap-1">
                  {topReasons.map(([reason, cnt]) => (
                    <Badge
                      key={reason}
                      variant="outline"
                      className="text-[10.5px] font-mono"
                    >
                      {reason} <span className="ml-1 text-muted-foreground">×{cnt}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {data.never_checked > 0 && topReasons.length === 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Hauptursache: {data.never_checked} Pakete wurden noch nie integrity-geprüft.
                Auto-Recheck-Cron läuft alle 15 Min — manuell mit Button rechts beschleunigen.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row lg:flex-col shrink-0">
          <Button
            size="sm"
            variant={tone === "destructive" ? "default" : "outline"}
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
            className="gap-1.5 h-8 text-xs"
          >
            {recheck.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Recheck (250)
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "warning" | "destructive" | "muted";
}) {
  const cls =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warning"
        ? "border-warning/40 bg-warning/5"
        : "border-border bg-muted/30";
  return (
    <div className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border ${cls}`}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono font-semibold tabular-nums">
        {value.toLocaleString("de-DE")}
      </span>
    </div>
  );
}
