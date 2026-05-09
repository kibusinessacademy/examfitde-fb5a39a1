import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Download, History } from "lucide-react";

type HistoryRow = {
  id: string;
  decision: string;
  prev_decision: string | null;
  quality_score: number | null;
  quality_badge: string | null;
  bronze_locked: boolean | null;
  report_status: string | null;
  rules_failed: number | null;
  rules_warned: number | null;
  report_signal: string | null;
  inputs: Record<string, unknown> | null;
  recorded_at: string;
  recorded_by: string;
};

type Row = {
  package_id: string;
  package_key: string | null;
  package_status: string | null;
  course_id: string | null;
  quality_score: number | null;
  quality_badge: string | null;
  scored_at: string | null;
  report_status: string | null;
  rules_failed: number | null;
  rules_warned: number | null;
  bronze_locked: boolean | null;
  gate_decision: string;
  report_signal: string | null;
};

const DECISIONS = [
  "ALL",
  "REPAIR_REQUIRED",
  "REPAIR_RECOMMENDED",
  "BRONZE_REVIEW_LOCKED",
  "REVIEW_REQUIRED",
  "NOT_SCORED",
  "READY_TO_PUBLISH",
  "PUBLISHED",
] as const;

const decisionTone = (d: string): "destructive" | "warning" | "success" | "secondary" => {
  if (d === "REPAIR_REQUIRED") return "destructive";
  if (d === "REPAIR_RECOMMENDED" || d === "BRONZE_REVIEW_LOCKED") return "warning";
  if (d === "READY_TO_PUBLISH" || d === "PUBLISHED") return "success";
  return "secondary";
};

export function QualityGateDecisionsCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");
  const [error, setError] = useState<string | null>(null);

  const [drillPkg, setDrillPkg] = useState<Row | null>(null);
  const [drillRows, setDrillRows] = useState<HistoryRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [recordingNow, setRecordingNow] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase.rpc(
      "admin_get_quality_gate_decisions" as any,
      { p_decision: filter === "ALL" ? null : filter, p_limit: 200 },
    );
    if (error) setError(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  };

  const loadHistory = async (pkg: Row) => {
    setDrillPkg(pkg);
    setDrillLoading(true); setDrillRows([]);
    const { data, error } = await supabase.rpc(
      "admin_get_gate_decision_history" as any,
      { p_package_id: pkg.package_id, p_limit: 50 },
    );
    if (!error) setDrillRows((data as HistoryRow[]) ?? []);
    setDrillLoading(false);
  };

  const recordNow = async () => {
    setRecordingNow(true);
    await supabase.rpc("admin_record_gate_decisions_now" as any);
    setRecordingNow(false);
    void load();
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.gate_decision, (m.get(r.gate_decision) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const exportCsv = () => {
    const header = [
      "package_id","package_key","package_status","quality_score","quality_badge",
      "gate_decision","bronze_locked","rules_failed","rules_warned","report_signal","scored_at",
    ];
    const lines = [header.join(",")];
    rows.forEach(r => {
      lines.push([
        r.package_id, r.package_key ?? "", r.package_status ?? "",
        r.quality_score ?? "", r.quality_badge ?? "",
        r.gate_decision, r.bronze_locked ?? "",
        r.rules_failed ?? "", r.rules_warned ?? "",
        r.report_signal ?? "", r.scored_at ?? "",
      ].map(v => String(v).replace(/,/g, ";")).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `quality-gate-decisions-${new Date().toISOString()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Quality Gate Decisions</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DECISIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void recordNow()} disabled={recordingNow}>
            <History className={`h-3.5 w-3.5 ${recordingNow ? "animate-spin" : ""}`} /> Snapshot
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="flex flex-wrap gap-1.5">
          {summary.map(([d, n]) => (
            <Badge key={d} variant={decisionTone(d) as any} className="text-[11px]">
              {d}: {n}
            </Badge>
          ))}
        </div>
        <div className="border rounded text-xs max-h-[420px] overflow-auto">
          <table className="w-full">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-1">package_key</th>
                <th className="px-2 py-1">decision</th>
                <th className="px-2 py-1">score</th>
                <th className="px-2 py-1">badge</th>
                <th className="px-2 py-1">status</th>
                <th className="px-2 py-1">signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.package_id}
                  className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => void loadHistory(r)}
                >
                  <td className="px-2 py-1 font-mono">{r.package_key ?? r.package_id.slice(0, 8)}</td>
                  <td className="px-2 py-1">
                    <Badge variant={decisionTone(r.gate_decision) as any} className="text-[10px]">
                      {r.gate_decision}
                    </Badge>
                  </td>
                  <td className="px-2 py-1">{r.quality_score ?? "—"}</td>
                  <td className="px-2 py-1">{r.quality_badge ?? "—"}</td>
                  <td className="px-2 py-1">{r.package_status ?? "—"}</td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {r.bronze_locked ? "bronze_lock" : r.report_signal ?? "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">Keine Daten</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Sheet open={!!drillPkg} onOpenChange={(o) => !o && setDrillPkg(null)}>
        <SheetContent className="w-[480px] sm:max-w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">
              {drillPkg?.package_key ?? drillPkg?.package_id.slice(0, 8)}
            </SheetTitle>
            <SheetDescription>Decision History (last 50)</SheetDescription>
          </SheetHeader>
          <div className="mt-3 space-y-2 text-xs">
            {drillLoading && <div className="text-muted-foreground">Lade…</div>}
            {!drillLoading && !drillRows.length && (
              <div className="text-muted-foreground">Noch keine History — drücke „Snapshot".</div>
            )}
            {drillRows.map(h => (
              <div key={h.id} className="border rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {h.prev_decision && (
                      <Badge variant="outline" className="text-[10px] line-through opacity-60">
                        {h.prev_decision}
                      </Badge>
                    )}
                    <Badge variant={decisionTone(h.decision) as any} className="text-[10px]">
                      {h.decision}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground">{new Date(h.recorded_at).toLocaleString("de-DE")}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {h.quality_score !== null && <Badge variant="outline" className="text-[10px]">score {h.quality_score}</Badge>}
                  {h.quality_badge && <Badge variant="outline" className="text-[10px]">{h.quality_badge}</Badge>}
                  {h.bronze_locked && <Badge variant="warning" className="text-[10px]">bronze_lock</Badge>}
                  {h.report_signal && <Badge variant="outline" className="text-[10px]">{h.report_signal}</Badge>}
                  <Badge variant="outline" className="text-[10px]">{h.recorded_by}</Badge>
                </div>
                {h.inputs && (
                  <pre className="text-[10px] bg-muted/40 p-1.5 rounded overflow-x-auto font-mono">
{JSON.stringify(h.inputs, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
