/**
 * PIPELINE.RECOVERY.OS.3 — Lane Dispatcher Repair cockpit card.
 * Read-only KPI panel + buttons to trigger diagnose and audit.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Stethoscope, RefreshCw, ShieldAlert, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AuditSnapshot {
  generated_at: string;
  lf_attempts_6h: number;
  lf_skipped_due_to_quarantine_6h: number;
  planning_stuck_count: number;
  planning_restarts_emitted_24h: number;
  planning_manual_review_emitted_24h: number;
  done_reaudit_blocked_by_no_progress: number;
  done_ready_to_publish: number;
  actions_by_type_24h: Record<string, number>;
}

interface DiagnosisRow {
  package_id: string;
  job_id: string | null;
  cause: string;
  restart_safe: boolean;
  detail: string;
}

export function PipelineRecoveryOS3Card() {
  const qc = useQueryClient();
  const [diagnoses, setDiagnoses] = useState<DiagnosisRow[] | null>(null);

  const auditQ = useQuery({
    queryKey: ["pipeline-recovery", "audit-postos3"],
    queryFn: async (): Promise<AuditSnapshot | null> => {
      const { data, error } = await supabase.functions.invoke("pipeline-recovery-audit-postos3", { body: {} });
      if (error) throw error;
      return (data?.snapshot ?? null) as AuditSnapshot | null;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const diagnoseM = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipeline-recovery-diagnose", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setDiagnoses(data?.diagnoses ?? []);
      toast.success(`Diagnose abgeschlossen — ${data?.total ?? 0} Jobs`);
    },
    onError: (e: any) => toast.error(`Diagnose fehlgeschlagen: ${e?.message ?? e}`),
  });

  const refreshAudit = useMutation({
    mutationFn: async () => {
      await auditQ.refetch();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-recovery"] });
      toast.success("Audit aktualisiert");
    },
  });

  const s = auditQ.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Pipeline Recovery — OS.3 Lane Dispatcher
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => diagnoseM.mutate()} disabled={diagnoseM.isPending}>
            {diagnoseM.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Stethoscope className="h-3 w-3" />}
            <span className="ml-2">Planning Diagnose</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => refreshAudit.mutate()} disabled={auditQ.isFetching}>
            <RefreshCw className={`h-3 w-3 ${auditQ.isFetching ? "animate-spin" : ""}`} />
            <span className="ml-2">Audit Refresh</span>
          </Button>
        </div>

        {auditQ.isLoading && <div className="text-sm text-muted-foreground">Lade Audit-Snapshot…</div>}

        {s && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="LF Attempts (6h)" value={s.lf_attempts_6h} />
            <KPI label="LF Skipped (Quarantine 6h)" value={s.lf_skipped_due_to_quarantine_6h} highlight={s.lf_skipped_due_to_quarantine_6h > 0} />
            <KPI label="Planning Stuck >60m" value={s.planning_stuck_count} warn={s.planning_stuck_count > 0} />
            <KPI label="Planning Restarts (24h)" value={s.planning_restarts_emitted_24h} />
            <KPI label="Manual Review (24h)" value={s.planning_manual_review_emitted_24h} />
            <KPI label="No-Progress Locks" value={s.done_reaudit_blocked_by_no_progress} />
            <KPI label="Done ready_to_publish" value={s.done_ready_to_publish} highlight={s.done_ready_to_publish > 0} />
            <KPI label="Snapshot" value={new Date(s.generated_at).toLocaleTimeString()} />
          </div>
        )}

        {diagnoses && diagnoses.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-3 w-3" />
              Diagnose-Ergebnisse ({diagnoses.length})
            </div>
            <div className="max-h-64 overflow-auto rounded border divide-y">
              {diagnoses.slice(0, 30).map((d, i) => (
                <div key={`${d.job_id}-${i}`} className="text-xs p-2 flex flex-wrap items-center gap-2">
                  <Badge variant={d.restart_safe ? "default" : "destructive"}>{d.cause}</Badge>
                  <span className="font-mono text-muted-foreground">{d.package_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{d.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {diagnoses && diagnoses.length === 0 && (
          <div className="text-xs text-muted-foreground">Keine stuck Planning-Jobs gefunden.</div>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({ label, value, warn, highlight }: { label: string; value: number | string; warn?: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded border p-2 ${warn ? "border-destructive/40 bg-destructive/5" : highlight ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
