import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SeqRow {
  rule_key: string;
  decisions_total: number;
  applied_total: number;
  distinct_users: number;
  last_decided_at: string;
}

interface AlertRow {
  metric: string;
  model: string;
  baseline_value: number;
  current_value: number;
  delta: number;
  computed_at: string;
}

export function AdaptiveSequencingDecisionsCard() {
  const [rows, setRows] = useState<SeqRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: a }] = await Promise.all([
        supabase.rpc("admin_get_sequencing_decisions_summary", { p_window_days: 7 }),
        // RPC freshly created — types regeneration pending, cast via unknown.
        (supabase.rpc as unknown as (n: string) => Promise<{ data: unknown }>)("admin_get_ai_eval_regression_alerts"),
      ]);
      setRows((s ?? []) as SeqRow[]);
      setAlerts(((a ?? []) as unknown) as AlertRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adaptive Sequencing (7 Tage)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Lade …</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Sequencing-Decisions.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {rows.map((r) => (
                <div key={r.rule_key} className="flex items-center justify-between rounded-md border border-border p-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.rule_key}</span>
                    <span className="text-xs text-muted-foreground">
                      letzte: {r.last_decided_at ? new Date(r.last_decided_at).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.decisions_total} dec</Badge>
                    <Badge variant="secondary">{r.applied_total} appl</Badge>
                    <Badge variant="outline">{r.distinct_users} users</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Regression Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine offenen Regression-Flags.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {alerts.map((a, i) => (
                <div key={`${a.metric}-${a.model}-${i}`} className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{a.metric} · {a.model}</span>
                    <span className="text-xs text-muted-foreground">{new Date(a.computed_at).toLocaleString()}</span>
                  </div>
                  <Badge variant="destructive">Δ {Number(a.delta).toFixed(3)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdaptiveSequencingDecisionsCard;
