/**
 * Admin-Quarantäne-Card für pausierte/quarantänte Exam-Pool-Pakete.
 * Zeigt v_admin_exam_pool_paused mit 1-Klick-Aktionen: Restart / Cancel-All / Quarantäne.
 * Plus: Live-Regressionstest-Button (admin_test_heal_v3_invariants).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Play, XCircle, Lock, Beaker, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface PausedRow {
  package_id: string;
  package_title: string | null;
  package_status: string | null;
  current_stage: "paused" | "constraint_relax" | "provider_switch";
  fail_count_6h: number;
  last_stage_change_at: string;
  last_fail_at: string | null;
  active_jobs: number;
  cancelled_jobs_6h: number;
  last_job_activity: string | null;
  open_backlog_task_id: string | null;
}

interface InvariantResult {
  test: string;
  pass: boolean;
  detail: string;
}

interface InvariantsReport {
  tested_at: string;
  all_passed: boolean;
  results: InvariantResult[];
}

const STAGE_VARIANT: Record<PausedRow["current_stage"], "default" | "secondary" | "destructive"> = {
  paused: "destructive",
  constraint_relax: "default",
  provider_switch: "secondary",
};

export function ExamPoolQuarantineCard() {
  const qc = useQueryClient();
  const [report, setReport] = useState<InvariantsReport | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["exam-pool-paused"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_exam_pool_paused" as never)
        .select("*")
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PausedRow[];
    },
    refetchInterval: 30_000,
  });

  const restartMutation = useMutation({
    mutationFn: async (pkgId: string) => {
      const { data, error } = await supabase.rpc("admin_exam_pool_restart" as never, { p_package_id: pkgId } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Exam-Pool-Fallback zurückgesetzt"); qc.invalidateQueries({ queryKey: ["exam-pool-paused"] }); },
    onError: (e: Error) => toast.error("Restart fehlgeschlagen", { description: e.message }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (pkgId: string) => {
      const { data, error } = await supabase.rpc("admin_exam_pool_cancel_all" as never, { p_package_id: pkgId } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const cancelled = (data as { cancelled?: number })?.cancelled ?? 0;
      toast.success(`${cancelled} Jobs cancelled`);
      qc.invalidateQueries({ queryKey: ["exam-pool-paused"] });
    },
    onError: (e: Error) => toast.error("Cancel fehlgeschlagen", { description: e.message }),
  });

  const quarantineMutation = useMutation({
    mutationFn: async (pkgId: string) => {
      const reason = window.prompt("Quarantäne-Begründung (optional):") ?? "manual_quarantine";
      const { data, error } = await supabase.rpc("admin_exam_pool_quarantine" as never, { p_package_id: pkgId, p_reason: reason });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Paket quarantänt"); qc.invalidateQueries({ queryKey: ["exam-pool-paused"] }); },
    onError: (e: Error) => toast.error("Quarantäne fehlgeschlagen", { description: e.message }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_test_heal_v3_invariants" as never);
      if (error) throw error;
      return data as unknown as InvariantsReport;
    },
    onSuccess: (data) => {
      setReport(data);
      if (data.all_passed) toast.success("Alle 5 Invariants OK");
      else toast.error("Invariant-Verletzung erkannt");
    },
    onError: (e: Error) => toast.error("Regressionstest fehlgeschlagen", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Exam-Pool Quarantäne ({rows?.length ?? 0})
        </CardTitle>
        <Button size="sm" variant="outline" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
          <Beaker className="h-3 w-3 mr-1" />
          Heal v3 Invariants prüfen
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {report && (
          <div className="rounded-md border border-border-subtle p-2 text-xs space-y-1">
            <div className="flex items-center gap-2 font-medium">
              {report.all_passed ? <CheckCircle2 className="h-3 w-3 text-status-success" /> : <AlertTriangle className="h-3 w-3 text-status-error" />}
              Letzter Test: {new Date(report.tested_at).toLocaleString("de-DE")}
            </div>
            {report.results.map(r => (
              <div key={r.test} className="flex items-start gap-2">
                <Badge variant={r.pass ? "secondary" : "destructive"} className="shrink-0">{r.pass ? "PASS" : "FAIL"}</Badge>
                <div className="flex-1">
                  <div className="font-mono text-[11px]">{r.test}</div>
                  <div className="text-text-muted">{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-text-muted">Lade…</p>
        ) : (rows ?? []).length === 0 ? (
          <p className="text-xs text-text-muted">Keine pausierten oder quarantänten Pakete.</p>
        ) : (
          <div className="space-y-2">
            {(rows ?? []).map(r => (
              <div key={r.package_id} className="rounded-md border border-border-subtle p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.package_title ?? r.package_id.slice(0, 8)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant={STAGE_VARIANT[r.current_stage]}>{r.current_stage}</Badge>
                    {r.package_status && <Badge variant="outline">{r.package_status}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-text-muted">
                  <span>{r.fail_count_6h} fails/6h</span>
                  <span>aktive Jobs: <strong className={r.active_jobs > 0 && r.current_stage === "paused" ? "text-status-error" : ""}>{r.active_jobs}</strong></span>
                  <span>cancelled/6h: {r.cancelled_jobs_6h}</span>
                  {r.last_job_activity && <span>letzte Aktivität: {new Date(r.last_job_activity).toLocaleString("de-DE")}</span>}
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <Button size="sm" variant="outline" disabled={restartMutation.isPending} onClick={() => restartMutation.mutate(r.package_id)}>
                    <Play className="h-3 w-3 mr-1" /> Restart
                  </Button>
                  <Button size="sm" variant="outline" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(r.package_id)}>
                    <XCircle className="h-3 w-3 mr-1" /> Cancel All
                  </Button>
                  <Button size="sm" variant="destructive" disabled={quarantineMutation.isPending} onClick={() => quarantineMutation.mutate(r.package_id)}>
                    <Lock className="h-3 w-3 mr-1" /> Quarantäne
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
