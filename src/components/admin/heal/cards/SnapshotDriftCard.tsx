import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

type Summary = {
  total: number;
  with_drift: number;
  by_priority: Record<string, number> | null;
  stale_no_handbook: number;
  stale_no_tutor: number;
  stale_no_oral: number;
  latest_snapshot: string | null;
  generated_at: string;
};

type Row = {
  package_id: string;
  course_title: string;
  track: string;
  package_status: string;
  snapshot_date: string | null;
  snapshot_codes: string[] | null;
  live_codes: string[] | null;
  stale_codes: string[] | null;
  new_codes: string[] | null;
  drift_priority: "critical" | "high" | "low" | "none";
};

const prioRank: Record<string, number> = { critical: 0, high: 1, low: 2, none: 3 };

export function SnapshotDriftCard() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    const [s, r] = await Promise.all([
      supabase.rpc("admin_get_release_snapshot_drift_summary"),
      supabase.rpc("admin_get_release_snapshot_drift", { p_only_drift: true, p_limit: 100 }),
    ]);
    setSum((s.data as Summary) ?? null);
    setRows(((r.data as Row[]) ?? []).sort((a, b) => prioRank[a.drift_priority] - prioRank[b.drift_priority]));
    setLoading(false);
  }

  async function refreshSnapshot() {
    setRefreshing(true);
    await supabase.rpc("fn_snapshot_release_classification" as never);
    await load();
    setRefreshing(false);
  }

  useEffect(() => { load(); }, []);

  const prioBadge = (p: Row["drift_priority"]) => {
    const variant =
      p === "critical" ? "destructive" :
      p === "high" ? "default" :
      p === "low" ? "secondary" : "outline";
    return <Badge variant={variant as never}>{p}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Snapshot ↔ Live Drift</CardTitle>
          <p className="text-xs text-muted-foreground">
            Letzter Snapshot: {sum?.latest_snapshot ?? "—"} · Cron alle 6h
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshSnapshot} disabled={refreshing}>
          {refreshing ? "Refresh..." : "Snapshot jetzt aktualisieren"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Pakete gesamt" value={sum?.total} />
          <Kpi label="Mit Drift" value={sum?.with_drift} severity={(sum?.with_drift ?? 0) > 0 ? "warn" : "ok"} />
          <Kpi label="Stale NO_HANDBOOK" value={sum?.stale_no_handbook} severity={(sum?.stale_no_handbook ?? 0) > 0 ? "warn" : "ok"} />
          <Kpi label="Stale NO_TUTOR" value={sum?.stale_no_tutor} severity={(sum?.stale_no_tutor ?? 0) > 0 ? "warn" : "ok"} />
          <Kpi label="Stale NO_ORAL" value={sum?.stale_no_oral} severity={(sum?.stale_no_oral ?? 0) > 0 ? "warn" : "ok"} />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Lädt …</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-emerald-600">Kein Drift — Snapshot deckt sich mit Live-View ✓</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2">
                <tr className="text-left">
                  <th className="px-2 py-1">Prio</th>
                  <th className="px-2 py-1">Paket</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Stale (Snapshot ⊃ Live)</th>
                  <th className="px-2 py-1">Neu (Live ⊃ Snapshot)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.package_id} className="border-t border-border">
                    <td className="px-2 py-1">{prioBadge(r.drift_priority)}</td>
                    <td className="px-2 py-1">
                      <Link to={`/admin/studio/${r.package_id}`} className="text-primary hover:underline">
                        {r.course_title}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{r.package_status}</td>
                    <td className="px-2 py-1">
                      {(r.stale_codes ?? []).map((c) => <Badge key={c} variant="outline" className="mr-1">{c}</Badge>)}
                    </td>
                    <td className="px-2 py-1">
                      {(r.new_codes ?? []).map((c) => <Badge key={c} variant="destructive" className="mr-1">{c}</Badge>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, severity = "ok" }: { label: string; value?: number; severity?: "ok" | "warn" | "err" }) {
  return (
    <div className="flex flex-col items-start rounded-md border border-border bg-surface-2 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold ${severity === "err" ? "text-destructive" : severity === "warn" ? "text-amber-500" : "text-foreground"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}
