import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inbox, RefreshCw, AlertTriangle } from "lucide-react";

interface IntakeRow {
  id: string;
  source_key: string | null;
  canonical_title: string | null;
  title_raw: string | null;
  category: string | null;
  provider_name: string | null;
  intake_status: string | null;
  rejection_reason: string | null;
  last_error: string | null;
  last_job_status: string | null;
  last_job_type: string | null;
  last_job_at: string | null;
  failed_jobs: number | null;
  minutes_since_last_seen: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  discovered: "bg-slate-500 text-white",
  extracting: "bg-blue-500 text-white",
  normalizing: "bg-indigo-500 text-white",
  ready_for_factory: "bg-emerald-600 text-white",
  failed: "bg-red-600 text-white",
  quarantined: "bg-orange-600 text-white",
};

export function IntakeConsoleCard() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("v_admin_intake_console")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as IntakeRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.intake_status !== statusFilter) return false;
    if (filter && !`${r.canonical_title ?? ""} ${r.title_raw ?? ""} ${r.source_key ?? ""}`.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const stats = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.intake_status ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" /> Intake Console
          <span className="text-xs text-muted-foreground">— Curriculum-Eingang & Faktoren-Bereitschaft</span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={statusFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter("all")}>Alle ({rows.length})</Badge>
          {Object.entries(stats).map(([s, c]) => (
            <Badge key={s} variant={statusFilter === s ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter(s)}>
              {s}: {c}
            </Badge>
          ))}
        </div>
        <Input placeholder="Filter Titel oder Source-Key…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-xs" />
        <div className="rounded border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Title</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Last Job</th>
                <th className="text-left p-2">Last Error</th>
                <th className="text-right p-2">Failed</th>
                <th className="text-right p-2">Idle (min)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{r.canonical_title ?? r.title_raw ?? r.source_key}</div>
                    <div className="text-muted-foreground text-[10px]">{r.category} · {r.provider_name}</div>
                  </td>
                  <td className="p-2">
                    <Badge className={STATUS_COLOR[r.intake_status ?? ""] ?? "bg-slate-400 text-white"}>
                      {r.intake_status ?? "—"}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.last_job_type ?? "—"} <br />
                    <span className="text-[10px]">{r.last_job_status ?? ""}</span>
                  </td>
                  <td className="p-2 max-w-[260px]">
                    {r.last_error ? (
                      <span className="text-red-600 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5" /><span className="truncate">{r.last_error}</span></span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right">{r.failed_jobs ?? 0}</td>
                  <td className="p-2 text-right">{r.minutes_since_last_seen != null ? Math.round(r.minutes_since_last_seen) : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Keine Einträge</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
