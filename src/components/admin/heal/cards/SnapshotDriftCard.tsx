import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Wand2, Activity } from "lucide-react";

type Summary = {
  total: number;
  with_drift: number;
  by_priority: Record<string, number> | null;
  by_kind: Record<string, number> | null;
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
  has_drift: boolean;
  drift_priority: "critical" | "high" | "low" | "none";
  drift_kind: "regression" | "mixed" | "stale_only" | "low" | "none";
};

const prioRank: Record<string, number> = { critical: 0, high: 1, low: 2, none: 3 };

const kindLabel: Record<Row["drift_kind"], { label: string; tone: "destructive" | "default" | "secondary" | "outline" }> = {
  regression: { label: "Regression", tone: "destructive" },
  mixed: { label: "Mixed", tone: "destructive" },
  stale_only: { label: "Stale", tone: "secondary" },
  low: { label: "Low", tone: "outline" },
  none: { label: "—", tone: "outline" },
};

export function SnapshotDriftCard() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    const { error } = await supabase.rpc("fn_snapshot_release_classification" as never);
    if (error) toast.error("Snapshot fehlgeschlagen: " + error.message);
    else toast.success("Snapshot aktualisiert");
    await load();
    setRefreshing(false);
  }

  async function revalidatePackage(pkg: Row) {
    setBusyId(pkg.package_id);
    const { data, error } = await supabase.rpc("admin_revalidate_package_drift", { p_package_id: pkg.package_id });
    if (error) {
      toast.error(`Live-Validation fehlgeschlagen: ${error.message}`);
    } else {
      const drift = (data as { drift?: Row })?.drift;
      if (drift && drift.has_drift) {
        setRows((prev) => prev.map((r) => (r.package_id === pkg.package_id ? { ...r, ...drift } : r)));
        toast.message(`${pkg.course_title}: ${drift.drift_kind}`, { description: `Stale: ${(drift.stale_codes ?? []).length} · Neu: ${(drift.new_codes ?? []).length}` });
      } else {
        setRows((prev) => prev.filter((r) => r.package_id !== pkg.package_id));
        toast.success(`${pkg.course_title}: kein Drift mehr ✓`);
      }
    }
    setBusyId(null);
  }

  async function autoReconcile(dryRun: boolean) {
    setReconciling(true);
    const { data, error } = await supabase.rpc("admin_auto_reconcile_drift", { p_dry_run: dryRun, p_limit: 50 });
    if (error) {
      toast.error("Auto-Reconcile fehlgeschlagen: " + error.message);
    } else {
      const r = data as { repairs: number; resnapshots: number; skipped: number; dry_run: boolean };
      toast.success(
        `Auto-Reconcile ${r.dry_run ? "(Dry-Run)" : ""}: ${r.repairs} Repairs · ${r.resnapshots} Re-Snapshots · ${r.skipped} skipped`
      );
    }
    await load();
    setReconciling(false);
  }

  useEffect(() => { void load(); }, []);

  const prioBadge = (p: Row["drift_priority"]) => {
    const variant =
      p === "critical" ? "destructive" :
      p === "high" ? "default" :
      p === "low" ? "secondary" : "outline";
    return <Badge variant={variant as never}>{p}</Badge>;
  };

  const kindBadge = (k: Row["drift_kind"]) => {
    const v = kindLabel[k];
    return <Badge variant={v.tone}>{v.label}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Snapshot ↔ Live Drift</CardTitle>
          <p className="text-xs text-muted-foreground">
            Letzter Snapshot: {sum?.latest_snapshot ?? "—"} · Cron alle 6h ·
            Regeln: <span className="font-medium">regression+critical</span> → Repair-Workflow ·
            <span className="font-medium"> stale_only / high / low</span> → Re-Snapshot
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={refreshSnapshot} disabled={refreshing}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {refreshing ? "Snapshot..." : "Snapshot aktualisieren"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => autoReconcile(true)} disabled={reconciling}>
            Dry-Run
          </Button>
          <Button size="sm" onClick={() => autoReconcile(false)} disabled={reconciling}>
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            {reconciling ? "Reconcile..." : "Auto-Reconcile"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Pakete gesamt" value={sum?.total} />
          <Kpi label="Mit Drift" value={sum?.with_drift} severity={(sum?.with_drift ?? 0) > 0 ? "warn" : "ok"} />
          <Kpi label="Regression" value={(sum?.by_kind?.regression ?? 0) + (sum?.by_kind?.mixed ?? 0)} severity={((sum?.by_kind?.regression ?? 0) + (sum?.by_kind?.mixed ?? 0)) > 0 ? "err" : "ok"} />
          <Kpi label="Stale-only" value={sum?.by_kind?.stale_only} severity={(sum?.by_kind?.stale_only ?? 0) > 0 ? "warn" : "ok"} />
          <Kpi label="Low-Drift" value={sum?.by_kind?.low} />
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
                  <th className="px-2 py-1">Typ</th>
                  <th className="px-2 py-1">Paket</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Stale (Snapshot ⊃ Live)</th>
                  <th className="px-2 py-1">Neu (Live ⊃ Snapshot)</th>
                  <th className="px-2 py-1 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.package_id} className="border-t border-border align-top">
                    <td className="px-2 py-1">{prioBadge(r.drift_priority)}</td>
                    <td className="px-2 py-1">{kindBadge(r.drift_kind)}</td>
                    <td className="px-2 py-1">
                      <Link to={`/admin/studio/${r.package_id}`} className="text-primary hover:underline">
                        {r.course_title}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{r.track}</div>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{r.package_status}</td>
                    <td className="px-2 py-1">
                      {(r.stale_codes ?? []).map((c) => <Badge key={c} variant="outline" className="mr-1">{c}</Badge>)}
                    </td>
                    <td className="px-2 py-1">
                      {(r.new_codes ?? []).map((c) => <Badge key={c} variant="destructive" className="mr-1">{c}</Badge>)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === r.package_id}
                        onClick={() => revalidatePackage(r)}
                        title="Snapshot dieses Pakets neu lesen"
                      >
                        <Activity className="mr-1 h-3.5 w-3.5" />
                        {busyId === r.package_id ? "..." : "Live validieren"}
                      </Button>
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
