/**
 * Bridge 10 — B2B Ausbildungsleiter Intelligence
 *
 * Drei Sektionen:
 *  • Org Exam-Readiness Dashboard (Snapshot pro Org × Curriculum)
 *  • Open Risk Alerts (severity-sortiert)
 *  • Trainer Next-Best-Actions (priority-sortiert, dismiss/complete)
 *
 * Alle Daten ausschließlich über admin_get_*-RPCs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, CheckCircle2, XCircle, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface OrgDashRow {
  organization_id: string;
  curriculum_id: string | null;
  snapshot_date: string;
  total_learners: number;
  active_learners: number;
  avg_readiness: number | null;
  pct_at_risk: number | null;
  pct_ready: number | null;
  pass_rate: number | null;
  quality_score: number | null;
  open_alerts: number;
  open_actions: number;
}

interface AlertRow {
  id: string;
  organization_id: string;
  curriculum_id: string | null;
  alert_type: string;
  severity: string;
  title: string;
  detail: string;
  learners_affected: number;
  recommended_action: string | null;
  status: string;
  created_at: string;
}

interface ActionRow {
  id: string;
  organization_id: string;
  curriculum_id: string | null;
  action_type: string;
  priority: number;
  title: string;
  detail: string;
  status: string;
  alert_severity: string | null;
  alert_type: string | null;
  created_at: string;
}

const num = (n: number | null | undefined, suffix = "") =>
  n == null ? "—" : `${Number(n).toFixed(1)}${suffix}`;

const sevTone = (s: string) =>
  s === "CRITICAL" ? "border-destructive text-destructive"
  : s === "HIGH" ? "border-orange-500 text-orange-500"
  : s === "MEDIUM" ? "border-yellow-500 text-yellow-600"
  : "";

export function TrainerIntelligenceCard() {
  const qc = useQueryClient();

  const dashboard = useQuery({
    queryKey: ["org-exam-readiness-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_org_exam_readiness_dashboard" as any, { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as OrgDashRow[];
    },
    staleTime: 60_000, refetchInterval: 120_000,
  });

  const alerts = useQuery({
    queryKey: ["org-risk-alerts", "open"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_org_risk_alerts" as any, { p_limit: 25, p_status: "open" });
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
    staleTime: 60_000, refetchInterval: 120_000,
  });

  const actions = useQuery({
    queryKey: ["trainer-next-best-actions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_trainer_next_best_actions" as any, { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as ActionRow[];
    },
    staleTime: 60_000, refetchInterval: 120_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_generate_trainer_risk_alerts" as any);
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(`Generiert: ${res?.alerts_upserted ?? 0} Alerts · ${res?.actions_inserted ?? 0} Actions`);
      qc.invalidateQueries({ queryKey: ["org-exam-readiness-dashboard"] });
      qc.invalidateQueries({ queryKey: ["org-risk-alerts", "open"] });
      qc.invalidateQueries({ queryKey: ["trainer-next-best-actions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Generierung fehlgeschlagen"),
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const reason = window.prompt("Grund für Verwerfen (optional):") ?? null;
      const { error } = await supabase.rpc("admin_dismiss_trainer_action" as any, { p_action_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Action verworfen");
      qc.invalidateQueries({ queryKey: ["trainer-next-best-actions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Verwerfen fehlgeschlagen"),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const note = window.prompt("Abschluss-Notiz (optional):") ?? null;
      const { error } = await supabase.rpc("admin_complete_trainer_action" as any, { p_action_id: id, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Action erledigt");
      qc.invalidateQueries({ queryKey: ["trainer-next-best-actions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Abschluss fehlgeschlagen"),
  });

  const loading = dashboard.isLoading || alerts.isLoading || actions.isLoading;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4 text-primary" />
              Trainer Intelligence
              <Badge variant="outline" className="ml-2 text-xs">Bridge 10</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Org-Readiness · Risk Alerts · Next-Best-Actions für Ausbildungsleiter. SSOT:{" "}
              <code>organization_risk_alerts</code> · <code>trainer_action_recommendations</code>.
            </p>
          </div>
          <Button
            size="sm" variant="outline"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            Alerts regenerieren
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {/* Org Dashboard */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Org Exam-Readiness Dashboard
              </h4>
              {(dashboard.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Noch keine Org-Snapshots. <code>organization_learning_health</code> muss erst befüllt werden.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1.5 pr-3">Org</th>
                        <th className="text-right py-1.5 pr-3">Learner</th>
                        <th className="text-right py-1.5 pr-3">Aktiv</th>
                        <th className="text-right py-1.5 pr-3">Ø Readiness</th>
                        <th className="text-right py-1.5 pr-3">% At-Risk</th>
                        <th className="text-right py-1.5 pr-3">Quality</th>
                        <th className="text-right py-1.5 pr-3">Alerts</th>
                        <th className="text-right py-1.5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.data!.slice(0, 10).map((r) => (
                        <tr key={`${r.organization_id}:${r.curriculum_id}:${r.snapshot_date}`} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono">{r.organization_id.slice(0, 8)}…</td>
                          <td className="py-1.5 pr-3 text-right">{r.total_learners}</td>
                          <td className="py-1.5 pr-3 text-right">{r.active_learners}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.avg_readiness)}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.pct_at_risk, "%")}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.quality_score)}</td>
                          <td className="py-1.5 pr-3 text-right">
                            {r.open_alerts > 0 ? <Badge variant="destructive">{r.open_alerts}</Badge> : 0}
                          </td>
                          <td className="py-1.5 text-right">{r.open_actions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Alerts */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Open Risk Alerts
              </h4>
              {(alerts.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Keine offenen Alerts.</p>
              ) : (
                <ul className="space-y-2">
                  {alerts.data!.slice(0, 8).map((a) => (
                    <li key={a.id} className="border rounded-md p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={sevTone(a.severity)}>{a.severity}</Badge>
                        <span className="text-xs text-muted-foreground">{a.alert_type}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {a.learners_affected} Lernende
                        </span>
                      </div>
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.detail}</div>
                      {a.recommended_action && (
                        <div className="text-xs mt-1">
                          <span className="text-muted-foreground">Empfehlung: </span>
                          {a.recommended_action}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Actions */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Trainer Next-Best-Actions
              </h4>
              {(actions.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Keine offenen Aktionen.</p>
              ) : (
                <ul className="space-y-2">
                  {actions.data!.slice(0, 10).map((a) => (
                    <li key={a.id} className="border rounded-md p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">P{a.priority}</Badge>
                        <span className="text-xs text-muted-foreground">{a.action_type}</span>
                        {a.alert_severity && (
                          <Badge variant="outline" className={sevTone(a.alert_severity)}>
                            {a.alert_severity}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.detail}</div>
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm" variant="outline"
                          disabled={complete.isPending}
                          onClick={() => complete.mutate(a.id)}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Erledigt
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          disabled={dismiss.isPending}
                          onClick={() => dismiss.mutate(a.id)}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Verwerfen
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
