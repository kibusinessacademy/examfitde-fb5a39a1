/**
 * PipelineRecoveryCard
 * Aggregates Publish-Gate / Planning / LF / Provider / STUDIUM recovery.
 * Mutations require Reason + Operator approval per admin-ui-leitstelle-v1.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Risk { risk: number; confidence: number; impact: string; expected_recovery: string; false_positive_risk: number; operator_effort: string; }
interface Action {
  action_id: string;
  package_id: string | null;
  action_type: "enqueue_done_reaudit" | "restart_planning" | "mark_manual_review_required" | "propose_provider_fallback" | "diagnose_only";
  cause: string;
  reason: string;
  steps_to_enqueue: string[];
  metadata: Record<string, unknown>;
  risk: Risk;
}
interface Plan { package_id: string | null; status_snapshot: string; causes: string[]; actions: Action[]; }
interface Summary {
  generated_at: string;
  pipeline_health: "ok" | "degraded" | "critical";
  stuck_planning_count: number;
  done_pending_count: number;
  lf_loop_count: number;
  provider_loop_count: number;
  studium_routing_issues: number;
  recoverable_count: number;
  manual_review_count: number;
  plans: Plan[];
}

const HEALTH_BADGE: Record<Summary["pipeline_health"], { label: string; variant: "default" | "destructive" | "secondary" }> = {
  ok: { label: "OK", variant: "default" },
  degraded: { label: "WARN", variant: "secondary" },
  critical: { label: "CRIT", variant: "destructive" },
};

export function PipelineRecoveryCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pipeline-recovery", "plan"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; summary: Summary; hash: string }>(
        "pipeline-recovery-plan", { body: {} },
      );
      if (error) throw error;
      return data!;
    },
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const mutate = useMutation({
    mutationFn: async (args: { action: Action; reason: string; plan_id: string }) => {
      const { data, error } = await supabase.functions.invoke("pipeline-recovery-act", {
        body: {
          action_id: args.action.action_id,
          action_type: args.action.action_type,
          cause: args.action.cause,
          target_package_id: args.action.package_id,
          reason: args.reason || args.action.reason,
          steps_to_enqueue: args.action.steps_to_enqueue,
          metadata: args.action.metadata,
          plan_id: args.plan_id,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Recovery-Aktion ausgeführt");
      qc.invalidateQueries({ queryKey: ["pipeline-recovery"] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
    },
    onError: (e: Error) => toast.error(`Fehler: ${e.message}`),
  });

  const summary = data?.summary;
  const allActions = useMemo<Array<{ plan_id: string; action: Action }>>(() => {
    if (!summary) return [];
    return summary.plans.flatMap((p) =>
      p.actions.map((a) => ({ plan_id: data!.hash, action: a })),
    );
  }, [summary, data]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Pipeline Recovery OS.1
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Plan → Approval → Execute. Kein Publish-Bypass, kein Auto-Approve.
          </p>
        </div>
        {summary && (
          <Badge variant={HEALTH_BADGE[summary.pipeline_health].variant}>
            {HEALTH_BADGE[summary.pipeline_health].label}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade Recovery-Snapshot…</div>}
        {error && (
          <div className="text-sm text-destructive">
            Fehler: {(error as Error).message}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Kpi label="Done pending" value={summary.done_pending_count} severity={summary.done_pending_count > 0 ? "warn" : "ok"} />
              <Kpi label="Planning stuck" value={summary.stuck_planning_count} severity={summary.stuck_planning_count > 0 ? "warn" : "ok"} />
              <Kpi label="LF loops" value={summary.lf_loop_count} severity={summary.lf_loop_count > 0 ? "crit" : "ok"} />
              <Kpi label="Provider loops" value={summary.provider_loop_count} severity={summary.provider_loop_count > 0 ? "warn" : "ok"} />
              <Kpi label="STUDIUM routing" value={summary.studium_routing_issues} severity={summary.studium_routing_issues > 0 ? "crit" : "ok"} />
              <Kpi label="Recoverable" value={summary.recoverable_count} severity="info" />
              <Kpi label="Manual review" value={summary.manual_review_count} severity={summary.manual_review_count > 0 ? "warn" : "ok"} />
              <Kpi label="Plans" value={summary.plans.length} severity="info" />
            </div>

            {allActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Recovery-Aktionen nötig.</p>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {allActions.slice(0, 30).map(({ action, plan_id }) => (
                  <ActionRow
                    key={action.action_id}
                    action={action}
                    pending={mutate.isPending}
                    onRun={(reason) => mutate.mutate({ action, reason, plan_id })}
                  />
                ))}
                {allActions.length > 30 && (
                  <p className="text-xs text-muted-foreground">+ {allActions.length - 30} weitere Aktionen …</p>
                )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Snapshot: {new Date(summary.generated_at).toLocaleString("de-DE")} · Hash {data!.hash}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, severity }: { label: string; value: number; severity: "ok" | "warn" | "crit" | "info" }) {
  const cls =
    severity === "crit" ? "border-destructive/50 text-destructive"
    : severity === "warn" ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
    : severity === "info" ? "border-muted text-muted-foreground"
    : "border-emerald-500/50 text-emerald-700 dark:text-emerald-400";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ActionRow({ action, pending, onRun }: { action: Action; pending: boolean; onRun: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const isDiagnose = action.action_type === "diagnose_only";
  return (
    <div className="rounded-md border p-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono">{action.action_type}</div>
        <Badge variant="outline" className="text-[10px]">{action.cause}</Badge>
      </div>
      <div className="text-muted-foreground line-clamp-2">{action.reason}</div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[10px] text-muted-foreground">
          risk={action.risk.risk.toFixed(2)} · conf={action.risk.confidence.toFixed(2)} · effort={action.risk.operator_effort}
        </div>
        {isDiagnose ? (
          <Badge variant="secondary" className="text-[10px]">diagnose only</Badge>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={pending}>
                <Play className="h-3 w-3 mr-1" /> Ausführen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Recovery-Aktion ausführen
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <div><strong>{action.action_type}</strong> · {action.cause}</div>
                  <div className="text-xs">{action.reason}</div>
                  <Textarea placeholder="Grund (Pflicht)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction disabled={reason.trim().length < 5} onClick={() => onRun(reason.trim())}>
                  Ausführen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
