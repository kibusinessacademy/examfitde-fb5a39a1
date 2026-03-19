/**
 * PipelineRepairCard — Shows repair classification for all building packages.
 * Classifies each package as HEALTHY, LEGACY_REFINALIZE, SHARD_REFINALIZE,
 * ORCHESTRATION_DRIFT, or SHARD_DEFECT with one-click repair actions.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle, AlertTriangle, XCircle, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface RepairRow {
  package_id: string;
  title: string;
  stored_progress: number;
  real_progress: number;
  drift: number;
  done_steps: number;
  total_steps: number;
  gen_status: string;
  val_status: string;
  legacy_content_completed: number;
  shard_completed: number;
  shard_failed: number;
  finalizer_completed: number;
  finalizer_active: number;
  finalizer_failed: number;
  repair_class: string;
}

const REPAIR_LABELS: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  A_HEALTHY: { label: "Gesund", color: "text-emerald-400", icon: CheckCircle },
  B_LEGACY_REFINALIZE: { label: "Legacy Re-Finalize", color: "text-amber-400", icon: Wrench },
  B_SHARD_REFINALIZE: { label: "Shard Re-Finalize", color: "text-amber-400", icon: Wrench },
  B_STEP_STUCK: { label: "Step Stuck", color: "text-orange-400", icon: AlertTriangle },
  B_ORCHESTRATION_DRIFT: { label: "Orch. Drift", color: "text-orange-400", icon: AlertTriangle },
  C_SHARD_DEFECT: { label: "Shard Defekt", color: "text-destructive", icon: XCircle },
};

function useRepairClassification() {
  return useQuery({
    queryKey: ["admin", "pipeline-repair"],
    queryFn: async (): Promise<RepairRow[]> => {
      const { data, error } = await (supabase as any)
        .from("v_pipeline_repair_classification")
        .select("*")
        .order("repair_class", { ascending: true });
      if (error) throw error;
      return data as RepairRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function PipelineRepairCard() {
  const { data, isLoading, refetch } = useRepairClassification();
  const queryClient = useQueryClient();
  const [reconciling, setReconciling] = useState(false);

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const { data: result, error } = await (supabase as any).rpc("reconcile_legacy_content_steps");
      if (error) throw error;
      const reconciled = result?.reconciled || [];
      const healed = reconciled.filter((r: any) => r.action === "healed").length;
      toast.success(`${healed} Pakete reconciled`);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (e: any) {
      toast.error(`Fehler: ${e.message}`);
    } finally {
      setReconciling(false);
    }
  };

  if (isLoading) return null;

  const grouped = (data || []).reduce((acc, row) => {
    if (!acc[row.repair_class]) acc[row.repair_class] = [];
    acc[row.repair_class].push(row);
    return acc;
  }, {} as Record<string, RepairRow[]>);

  const hasRepairCandidates = Object.keys(grouped).some(
    (k) => k.startsWith("B_") || k.startsWith("C_")
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wrench className="h-4 w-4 text-primary" />
            Pipeline Repair Status
            {hasRepairCandidates && (
              <Badge variant="destructive" className="text-[10px]">
                {(data || []).filter((r) => r.repair_class !== "A_HEALTHY").length} reparierbar
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleReconcile}
            disabled={reconciling}
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", reconciling && "animate-spin")} />
            Reconcile
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cls, rows]) => {
              const meta = REPAIR_LABELS[cls] || {
                label: cls,
                color: "text-muted-foreground",
                icon: AlertTriangle,
              };
              const Icon = meta.icon;
              return (
                <div key={cls}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                    <span className={cn("text-xs font-semibold", meta.color)}>
                      {meta.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {rows.length}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 ml-5">
                    {rows.map((row) => (
                      <div
                        key={row.package_id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span
                          className="truncate max-w-[200px] font-medium"
                          title={row.title}
                        >
                          {row.title}
                        </span>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>
                            {row.done_steps}/{row.total_steps}
                          </span>
                          {row.drift > 3 && (
                            <span className="text-destructive font-bold">
                              Δ{row.drift}
                            </span>
                          )}
                          <span className="w-8 text-right">
                            {row.real_progress}%
                          </span>
                          {row.gen_status === "done" && (
                            <CheckCircle className="h-3 w-3 text-emerald-400" />
                          )}
                          {row.legacy_content_completed > 0 && (
                            <span title={`${row.legacy_content_completed} Legacy-Jobs`}>
                              L:{row.legacy_content_completed}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">
          Klassifikation: SSOT-Step-basiert · Drift = stored% − real%
        </div>
      </CardContent>
    </Card>
  );
}
