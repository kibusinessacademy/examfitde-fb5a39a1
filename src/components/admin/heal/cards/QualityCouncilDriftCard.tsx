/**
 * QualityCouncilDriftCard — Diagnose & chirurgische Reparatur des
 * package_steps.quality_council=queued Drifts.
 *
 * Cluster:
 *   • A_queued_no_qc_job        — pkg_status=queued, kein QC-Job → Bulk-Promote-Domain (NICHT hier)
 *   • A_building_no_qc_job      — pkg_status=building, kein QC-Job → HEAL: enqueue QC-Job
 *   • A_other_no_qc_job         — anderer pkg_status, kein QC-Job → manuell prüfen
 *   • B_active_qc_job           — QC-Job läuft → Throughput-Frage
 *   • C_failed_qc_only          — alle QC-Jobs failed → admin_retry_failed_step
 *   • D_qc_completed_step_drift — QC done, Step blieb queued → HEAL: step.status=done
 *   • E_mixed                   — Sonderfall, manuell sichten
 *
 * RPCs:
 *   admin_get_qc_step_drift_summary()
 *   admin_get_qc_step_drift_detail(p_cluster, p_limit)
 *   admin_repair_quality_council_drift(p_dry_run, p_limit)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Wrench, Play, AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SummaryRow {
  cluster: string;
  pkgs: number;
  heal_eligible_cnt: number;
  oldest_step_age_sec: number | null;
}

interface DetailRow {
  package_id: string;
  title: string | null;
  pkg_status: string;
  step_updated_at: string;
  step_age_sec: number;
  qc_total: number;
  qc_active: number;
  qc_failed: number;
  qc_cancelled: number;
  qc_completed: number;
  cluster: string;
  heal_eligible: boolean;
}

interface RepairRow {
  package_id: string;
  title: string | null;
  cluster: string;
  action: string;
  detail: string;
}

const CLUSTER_LABEL: Record<string, string> = {
  F_missing_curriculum_id: "F · curriculum_id fehlt (SSOT-Block)",
  A_queued_no_qc_job: "A · queued, kein QC-Job",
  A_building_no_qc_job: "A · building, kein QC-Job",
  A_other_no_qc_job: "A · sonstige, kein QC-Job",
  B_active_qc_job: "B · QC-Job aktiv",
  C_failed_qc_only: "C · QC failed",
  D_qc_completed_step_drift: "D · QC done, Step queued",
  E_mixed: "E · gemischt",
};

const CLUSTER_HINT: Record<string, string> = {
  F_missing_curriculum_id: "→ Datenintegrität: curriculum_id Backfill nötig",
  A_queued_no_qc_job: "→ Bulk-Promote queued→building",
  A_building_no_qc_job: "→ heilbar: QC-Job enqueuen",
  A_other_no_qc_job: "→ manuell prüfen (planning/blocked/archived)",
  B_active_qc_job: "→ Worker-Throughput abwarten",
  C_failed_qc_only: "→ Per-Step-Retry",
  D_qc_completed_step_drift: "→ heilbar: Step.status=done",
  E_mixed: "→ Einzelfall sichten",
};

function fmtAge(sec: number | null): string {
  if (!sec) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function QualityCouncilDriftCard() {
  const qc = useQueryClient();
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<RepairRow[] | null>(null);

  const summary = useQuery({
    queryKey: ["admin-qc-drift-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_qc_step_drift_summary" as any);
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    refetchInterval: 60_000,
  });

  const detail = useQuery({
    queryKey: ["admin-qc-drift-detail", openCluster],
    enabled: !!openCluster,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_qc_step_drift_detail" as any, {
        p_cluster: openCluster, p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as DetailRow[];
    },
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_repair_quality_council_drift" as any, {
        p_dry_run: true, p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as RepairRow[];
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      toast.success(`Dry-Run: ${data.length} heilende Aktionen vorbereitet`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_repair_quality_council_drift" as any, {
        p_dry_run: false, p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as RepairRow[];
    },
    onSuccess: (data) => {
      const enqueued = data.filter((r) => r.action === "qc_job_enqueued").length;
      const adoption = data.filter((r) => r.action === "qc_job_enqueued_for_adoption").length;
      const skippedCurr = data.filter((r) => r.action === "skip_missing_curriculum_id").length;
      const skipped = data.filter((r) => r.action.startsWith("skip") && r.action !== "skip_missing_curriculum_id").length;
      toast.success(
        `Repair: ${enqueued} QC enqueued · ${adoption} Adoption · ${skippedCurr} skip(curr=NULL) · ${skipped} other-skip`,
      );
      setDryRunResult(null);
      qc.invalidateQueries({ queryKey: ["admin-qc-drift-summary"] });
      qc.invalidateQueries({ queryKey: ["admin-qc-drift-detail"] });
      qc.invalidateQueries({ queryKey: ["admin-lane-health"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalEligible = (summary.data ?? []).reduce((acc, r) => acc + Number(r.heal_eligible_cnt), 0);

  return (
    <Card className="p-4 border-primary/30">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wrench className="h-4 w-4" /> Quality-Council Step-Drift
        </h3>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className="text-[10px]">live · 60s</Badge>
          {totalEligible > 0 && (
            <Badge variant="default" className="text-[10px]">
              {totalEligible} heilbar
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Gruppiert alle <code className="font-mono">package_steps.quality_council = queued</code>
        nach Ursache. Heilt chirurgisch nur Cluster <strong>A_building</strong> (QC-Job fehlt) und{" "}
        <strong>D</strong> (Step-Status nachziehen). Cluster A_queued bleibt Bulk-Promote-Domain.
      </p>

      {summary.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-1 mb-3">
          {(summary.data ?? []).map((row) => {
            const isOpen = openCluster === row.cluster;
            const isHealable = Number(row.heal_eligible_cnt) > 0;
            return (
              <div key={row.cluster}>
                <button
                  onClick={() => setOpenCluster(isOpen ? null : row.cluster)}
                  className={cn(
                    "w-full flex items-center justify-between text-xs rounded border p-2 hover:bg-muted/50 transition",
                    isHealable && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight
                      className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-90")}
                    />
                    <span className="font-mono font-semibold truncate">
                      {CLUSTER_LABEL[row.cluster] ?? row.cluster}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground text-[10px]">
                      {CLUSTER_HINT[row.cluster] ?? ""}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      oldest: {fmtAge(row.oldest_step_age_sec)}
                    </span>
                    {isHealable && (
                      <Badge variant="default" className="text-[10px]">
                        {row.heal_eligible_cnt} heilbar
                      </Badge>
                    )}
                    <span className="font-bold tabular-nums w-10 text-right">{row.pkgs}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="ml-4 mt-1 mb-2 space-y-0.5 max-h-48 overflow-y-auto text-[11px]">
                    {detail.isLoading ? (
                      <Skeleton className="h-12 w-full" />
                    ) : (detail.data ?? []).length === 0 ? (
                      <p className="text-muted-foreground py-2">Keine Pakete.</p>
                    ) : (
                      (detail.data ?? []).map((p) => (
                        <div
                          key={p.package_id}
                          className="flex items-center justify-between rounded border border-border/50 px-2 py-1"
                        >
                          <span className="truncate flex-1">{p.title ?? "(ohne Titel)"}</span>
                          <span className="text-muted-foreground shrink-0 ml-2 font-mono text-[10px]">
                            {p.pkg_status} · qc {p.qc_completed}c/{p.qc_active}a/{p.qc_failed}f ·{" "}
                            {fmtAge(p.step_age_sec)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {(summary.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Kein QC-Step-Drift vorhanden ✓
            </p>
          )}
        </div>
      )}

      {totalEligible > 0 && (
        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-warning" />
              Chirurgische Reparatur (max. 50 pro Lauf)
            </span>
          </div>
          <div className="flex gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => dryRun.mutate()}
              disabled={dryRun.isPending}
            >
              {dryRun.isPending ? "Prüfe…" : "Dry-Run"}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => execute.mutate()}
              disabled={execute.isPending || !dryRunResult || dryRunResult.length === 0}
            >
              <Play className="h-3 w-3 mr-1" />
              {execute.isPending ? "Repair…" : `Execute (${dryRunResult?.length ?? 0})`}
            </Button>
          </div>

          {dryRunResult && dryRunResult.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto text-[11px]">
              {dryRunResult.map((r) => (
                <div
                  key={r.package_id + r.action}
                  className="flex items-center justify-between rounded border p-1.5"
                >
                  <span className="truncate flex-1">{r.title ?? r.package_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground shrink-0 ml-2 font-mono">
                    {r.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
