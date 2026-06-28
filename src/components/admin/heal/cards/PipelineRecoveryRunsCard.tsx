/**
 * PIPELINE.RECOVERY.OS.2 — Run history + Verify panel.
 * Lists recent recovery runs, lets operator trigger verification,
 * shows per-action outcome (success / no_change / regressed / pending).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface RunRow {
  run_id: string;
  status: string;
  reason: string;
  action_ids: string[];
  outcome: any;
  created_at: string;
  executed_at: string | null;
  verified_at: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  executing: "outline",
  executed: "secondary",
  verifying: "secondary",
  verified: "default",
  verified_partial: "secondary",
  verified_regressed: "destructive",
  timeout: "destructive",
  failed: "destructive",
};

export function PipelineRecoveryRunsCard() {
  const qc = useQueryClient();
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["pipeline-recovery", "runs"],
    queryFn: async (): Promise<RunRow[]> => {
      const { data, error } = await supabase
        .from("pipeline_recovery_runs")
        .select("run_id,status,reason,action_ids,outcome,created_at,executed_at,verified_at")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as RunRow[];
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const verify = useMutation({
    mutationFn: async (runId: string) => {
      setVerifyingId(runId);
      const { data, error } = await supabase.functions.invoke("pipeline-recovery-verify", { body: { run_id: runId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Verifiziert: ${d?.summary?.success ?? 0}✓ / ${d?.summary?.regressed ?? 0}↓ / ${d?.summary?.pending ?? 0}⏳`);
      qc.invalidateQueries({ queryKey: ["pipeline-recovery"] });
    },
    onError: (e: Error) => toast.error(`Verify-Fehler: ${e.message}`),
    onSettled: () => setVerifyingId(null),
  });

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-primary" />
            Recovery Runs (OS.2)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Ausführungen + Outcome-Verifikation. Re-Audit erlaubt — kein Publish-Bypass.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3 mr-1" /> Aktualisieren
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade Runs…</div>}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-sm text-muted-foreground">Noch keine Recovery-Runs.</p>
        )}
        {data?.map((r) => {
          const summary = r.outcome?.summary as { success?: number; no_change?: number; regressed?: number; pending?: number; success_rate?: number } | undefined;
          const canVerify = r.status === "executed" || r.status === "verifying" || r.status === "verified_partial";
          return (
            <div key={r.run_id} className="rounded-md border p-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[11px] truncate">{r.run_id}</div>
                <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-[10px]">{r.status}</Badge>
              </div>
              <div className="text-muted-foreground line-clamp-1">{r.reason}</div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[10px] text-muted-foreground flex flex-wrap gap-2">
                  <span>{r.action_ids.length} Aktionen</span>
                  {summary && (
                    <>
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{summary.success ?? 0}</span>
                      <span>~{summary.no_change ?? 0}</span>
                      <span className="text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{summary.regressed ?? 0}</span>
                      <span>⏳{summary.pending ?? 0}</span>
                      {typeof summary.success_rate === "number" && <span>· rate {Math.round(summary.success_rate * 100)}%</span>}
                    </>
                  )}
                  <span>· {new Date(r.created_at).toLocaleTimeString("de-DE")}</span>
                </div>
                {canVerify && (
                  <Button size="sm" variant="outline" disabled={verifyingId === r.run_id} onClick={() => verify.mutate(r.run_id)}>
                    {verifyingId === r.run_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verifizieren"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
