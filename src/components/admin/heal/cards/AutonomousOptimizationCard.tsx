import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Summary = {
  events?: {
    total?: number;
    detected?: number;
    acted_on?: number;
    blocked?: number;
    critical?: number;
    by_type?: Record<string, number>;
  };
  actions?: {
    proposed?: number;
    approved?: number;
    applied?: number;
    reverted?: number;
    blocked?: number;
  };
  guardrails?: Array<{
    key: string;
    scope: string;
    rule_type: "hard_block" | "requires_approval" | "soft_warning";
    enabled: boolean;
  }>;
  generated_at?: string;
};

type TuningAction = {
  id: string;
  action_type: string;
  scope: string;
  target_ref: Record<string, unknown>;
  proposed_change: Record<string, unknown>;
  guardrail_key: string | null;
  status: string;
  created_at: string;
  notes: string | null;
};

export function AutonomousOptimizationCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<TuningAction[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [{ data: s }, { data: a }] = await Promise.all([
        supabase.rpc("admin_get_autonomous_optimization_summary" as any),
        supabase.rpc("admin_get_auto_tuning_actions" as any, { p_limit: 25, p_status: null }),
      ]);
      setSummary((s as Summary) || null);
      setActions(((a as TuningAction[]) || []));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    const { error } = await supabase.rpc("admin_approve_auto_tuning_action" as any, { p_action_id: id, p_notes: null });
    if (error) return toast.error(error.message);
    toast.success("Aktion freigegeben");
    load();
  }

  async function revert(id: string) {
    const reason = window.prompt("Revert-Grund (≥3 Zeichen)?");
    if (!reason || reason.length < 3) return;
    const { error } = await supabase.rpc("admin_revert_auto_tuning_action" as any, { p_action_id: id, p_reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Aktion zurückgenommen");
    load();
  }

  const ev = summary?.events || {};
  const act = summary?.actions || {};

  const kpi = (label: string, val: number | undefined, severity: "ok" | "warn" | "err" = "ok") => (
    <div className="flex flex-col rounded-md border border-border bg-surface-2 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold ${severity === "err" ? "text-destructive" : severity === "warn" ? "text-amber-500" : "text-foreground"}`}>
        {val ?? 0}
      </span>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Autonomous Recovery & Optimization (Bridge 11)</CardTitle>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {kpi("Events (30d)", ev.total)}
          {kpi("Detected", ev.detected, ev.detected ? "warn" : "ok")}
          {kpi("Critical", ev.critical, ev.critical ? "err" : "ok")}
          {kpi("Acted on", ev.acted_on)}
          {kpi("Guardrail-Blocked", ev.blocked, ev.blocked ? "warn" : "ok")}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {kpi("Proposed", act.proposed, act.proposed ? "warn" : "ok")}
          {kpi("Approved", act.approved)}
          {kpi("Applied", act.applied)}
          {kpi("Reverted", act.reverted, act.reverted ? "warn" : "ok")}
          {kpi("Blocked", act.blocked, act.blocked ? "err" : "ok")}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Guardrails</h4>
          <div className="flex flex-wrap gap-2">
            {(summary?.guardrails || []).map((g) => (
              <Badge
                key={g.key}
                variant={g.rule_type === "hard_block" ? "destructive" : g.rule_type === "requires_approval" ? "default" : "outline"}
                title={g.scope}
              >
                {g.key} · {g.rule_type}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Recent Auto-Tuning Actions</h4>
          <div className="max-h-96 overflow-auto rounded-md border border-border bg-surface-2 p-2">
            {actions.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Keine Aktionen.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">Status</th>
                    <th className="p-1">Action</th>
                    <th className="p-1">Scope</th>
                    <th className="p-1">Target</th>
                    <th className="p-1">Guardrail</th>
                    <th className="p-1">Erstellt</th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="p-1">
                        <Badge variant={
                          a.status === "applied" ? "default" :
                          a.status === "blocked" || a.status === "reverted" ? "destructive" :
                          a.status === "approved" ? "outline" : "secondary"
                        }>{a.status}</Badge>
                      </td>
                      <td className="p-1 font-medium">{a.action_type}</td>
                      <td className="p-1">{a.scope}</td>
                      <td className="p-1 font-mono text-[10px]">{JSON.stringify(a.target_ref)}</td>
                      <td className="p-1">{a.guardrail_key || "—"}</td>
                      <td className="p-1 text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                      <td className="p-1 text-right">
                        {a.status === "proposed" && (
                          <Button size="sm" variant="outline" onClick={() => approve(a.id)}>Approve</Button>
                        )}
                        {(a.status === "applied" || a.status === "approved") && (
                          <Button size="sm" variant="ghost" onClick={() => revert(a.id)}>Revert</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          stand: {summary?.generated_at ? new Date(summary.generated_at).toLocaleString() : "—"}
        </div>
      </CardContent>
    </Card>
  );
}
