/**
 * ExamPoolDriftLogCard — Letzte 7 Tage Cron-Läufe von fn_detect_and_heal_exam_pool_enqueue_drift
 *
 * Quelle: View v_admin_exam_pool_drift_log + RPC get_exam_pool_drift_log_for_package
 * - Lauf-Tabelle (eine Zeile pro Cron-Lauf)
 * - JSON-Detail per Klick
 * - Drilldown pro Package-ID (Input)
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Activity, RefreshCw, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type DriftRun = {
  run_id: string;
  run_at: string;
  result_status: string | null;
  total_candidates: number | null;
  healed: number | null;
  nudged: number | null;
  skipped: number | null;
  cooldown_skips: number | null;
  update_failed: number | null;
  already_done_or_running: number | null;
  dry_run: boolean | null;
  candidates_json: unknown;
  nudged_ids: unknown;
  healed_ids: unknown;
  skip_details_json: unknown;
  duration_ms: number | null;
};

type DrilldownRow = {
  run_id: string;
  run_at: string;
  was_candidate: boolean;
  was_nudged: boolean;
  was_healed: boolean;
  was_skipped: boolean;
  skip_reason: string | null;
  approved_q: number | null;
  in_cooldown: boolean | null;
  step_status: string | null;
};

function statusBadge(s: string | null) {
  if (s === "success") return <Badge className="bg-success/15 text-success border-success/30">success</Badge>;
  if (s === "noop") return <Badge variant="secondary">noop</Badge>;
  if (s === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">{s ?? "?"}</Badge>;
}

export function ExamPoolDriftLogCard() {
  const [detail, setDetail] = useState<DriftRun | null>(null);
  const [pkgId, setPkgId] = useState("");
  const [drilldownPkg, setDrilldownPkg] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ["exam-pool-drift-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_exam_pool_drift_log" as any)
        .select("*")
        .order("run_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as DriftRun[];
    },
    refetchInterval: 60_000,
  });

  const drilldown = useQuery({
    queryKey: ["exam-pool-drift-drilldown", drilldownPkg],
    enabled: !!drilldownPkg,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_exam_pool_drift_log_for_package" as any,
        { p_package_id: drilldownPkg },
      );
      if (error) throw error;
      return (data ?? []) as unknown as DrilldownRow[];
    },
  });

  const totals = (runs.data ?? []).reduce(
    (acc, r) => {
      acc.candidates += r.total_candidates ?? 0;
      acc.healed += r.healed ?? 0;
      acc.nudged += r.nudged ?? 0;
      acc.skipped += r.skipped ?? 0;
      acc.cooldown += r.cooldown_skips ?? 0;
      return acc;
    },
    { candidates: 0, healed: 0, nudged: 0, skipped: 0, cooldown: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Exam-Pool Drift-Log (7 Tage)
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => runs.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 text-xs">
          <Badge variant="outline">Läufe: {runs.data?.length ?? 0}</Badge>
          <Badge variant="outline">Σ Kandidaten: {totals.candidates}</Badge>
          <Badge className="bg-success/15 text-success border-success/30">geheilt: {totals.healed}</Badge>
          <Badge className="bg-primary/15 text-primary border-primary/30">genudged: {totals.nudged}</Badge>
          <Badge variant="secondary">skipped: {totals.skipped}</Badge>
          <Badge variant="outline">cooldown: {totals.cooldown}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drilldown per Package */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Drilldown pro Package-ID</label>
            <Input
              placeholder="UUID des Pakets…"
              value={pkgId}
              onChange={(e) => setPkgId(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => setDrilldownPkg(pkgId.trim() || null)}
            disabled={!pkgId.trim()}
          >
            <Search className="h-4 w-4 mr-1" /> Anzeigen
          </Button>
        </div>

        {/* Lauf-Tabelle */}
        {runs.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : runs.data?.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine Läufe in den letzten 7 Tagen.</div>
        ) : (
          <ScrollArea className="h-72 border rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Zeit</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Kand.</th>
                  <th className="p-2 text-right">Heal</th>
                  <th className="p-2 text-right">Nudge</th>
                  <th className="p-2 text-right">Skip</th>
                  <th className="p-2 text-right">CD</th>
                  <th className="p-2 text-right">ms</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.data?.map((r) => (
                  <tr key={r.run_id} className="border-t hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap">{new Date(r.run_at).toLocaleString("de-DE")}</td>
                    <td className="p-2">{statusBadge(r.result_status)}</td>
                    <td className="p-2 text-right">{r.total_candidates ?? 0}</td>
                    <td className="p-2 text-right">{r.healed ?? 0}</td>
                    <td className="p-2 text-right">{r.nudged ?? 0}</td>
                    <td className="p-2 text-right">{r.skipped ?? 0}</td>
                    <td className="p-2 text-right">{r.cooldown_skips ?? 0}</td>
                    <td className="p-2 text-right">{r.duration_ms ?? "–"}</td>
                    <td className="p-2">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}

        {/* JSON-Detail Dialog */}
        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Lauf-Details — {detail && new Date(detail.run_at).toLocaleString("de-DE")}</DialogTitle>
            </DialogHeader>
            {detail && (
              <ScrollArea className="max-h-[60vh]">
                <pre className="text-xs p-2 bg-muted rounded overflow-auto">
                  {JSON.stringify(detail, null, 2)}
                </pre>
              </ScrollArea>
            )}
          </DialogContent>
        </Dialog>

        {/* Drilldown Dialog */}
        <Dialog open={!!drilldownPkg} onOpenChange={(o) => !o && setDrilldownPkg(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Drilldown — {drilldownPkg}</DialogTitle>
            </DialogHeader>
            {drilldown.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !drilldown.data || drilldown.data.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Dieses Paket war in den letzten 7 Tagen nicht Kandidat einer Drift-Detection.
              </div>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2">Zeit</th>
                      <th className="p-2">Cand</th>
                      <th className="p-2">Healed</th>
                      <th className="p-2">Nudged</th>
                      <th className="p-2">Skipped</th>
                      <th className="p-2">Reason</th>
                      <th className="p-2 text-right">approved</th>
                      <th className="p-2">Step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown.data.map((d) => (
                      <tr key={d.run_id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{new Date(d.run_at).toLocaleString("de-DE")}</td>
                        <td className="p-2">{d.was_candidate ? "✓" : "–"}</td>
                        <td className="p-2">{d.was_healed ? "✓" : "–"}</td>
                        <td className="p-2">{d.was_nudged ? "✓" : "–"}</td>
                        <td className="p-2">{d.was_skipped ? "✓" : "–"}</td>
                        <td className="p-2">{d.skip_reason ?? "–"}</td>
                        <td className="p-2 text-right">{d.approved_q ?? "–"}</td>
                        <td className="p-2">{d.step_status ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
