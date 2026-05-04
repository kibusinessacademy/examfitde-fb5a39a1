import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Drift = {
  queue_claimability?: Record<string, number>;
  pricing_blocked_publish?: number;
  governance_ghost_steps?: number;
  step_job_gap?: number;
  schema_drift_recent?: number;
  generated_at?: string;
};

export function DriftOverviewCard() {
  const [d, setD] = useState<Drift | null>(null);
  const [detail, setDetail] = useState<{ kind: string; rows: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.rpc("admin_get_drift_overview");
    setD((data as Drift) || null);
    setLoading(false);
  }
  async function drill(kind: string) {
    const { data } = await supabase.rpc("admin_get_drift_detail", { p_kind: kind });
    setDetail({ kind, rows: (data as any[]) || [] });
  }
  useEffect(() => { load(); }, []);

  const kpi = (label: string, val: number | undefined, kind?: string, severity: "ok"|"warn"|"err"="ok") => (
    <button
      onClick={() => kind && drill(kind)}
      className="flex flex-col items-start rounded-md border border-border bg-surface-2 p-3 text-left hover:bg-surface-3"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold ${severity==="err"?"text-destructive":severity==="warn"?"text-amber-500":"text-foreground"}`}>
        {val ?? "—"}
      </span>
    </button>
  );

  const qc = d?.queue_claimability ?? {};
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Live-Drift Übersicht</CardTitle>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "…" : "Refresh"}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {kpi("DAG-blocked", qc.dag_blocked, "dag_blocked", qc.dag_blocked ? "warn" : "ok")}
          {kpi("Pricing blocked", d?.pricing_blocked_publish, "pricing_blocked", d?.pricing_blocked_publish ? "warn" : "ok")}
          {kpi("Governance Ghost", d?.governance_ghost_steps, "governance_ghost", d?.governance_ghost_steps ? "err" : "ok")}
          {kpi("Step↔Job Gap", d?.step_job_gap, "step_job_gap", d?.step_job_gap ? "warn" : "ok")}
          {kpi("Schema drift", d?.schema_drift_recent, undefined, d?.schema_drift_recent ? "err" : "ok")}
        </div>
        <div className="text-xs text-muted-foreground">
          stand: {d?.generated_at ? new Date(d.generated_at).toLocaleString() : "—"}
        </div>

        {detail && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <Badge variant="outline">{detail.kind}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>schließen</Button>
            </div>
            <div className="max-h-96 overflow-auto text-xs">
              {detail.rows.length === 0 ? (
                <div className="text-muted-foreground">Keine Treffer.</div>
              ) : (
                <table className="w-full">
                  <thead><tr><th className="text-left">Paket</th><th className="text-left">Detail</th></tr></thead>
                  <tbody>
                    {detail.rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-2">{r.title || r.package_id}</td>
                        <td className="py-1 font-mono text-[11px]">{JSON.stringify(r.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
