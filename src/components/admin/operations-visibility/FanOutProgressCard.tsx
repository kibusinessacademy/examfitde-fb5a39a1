import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Activity, RefreshCw } from "lucide-react";

interface FanOutRow {
  step_id: string;
  package_id: string;
  step_key: string;
  step_status: string;
  job_id: string | null;
  started_at: string | null;
  last_error: string | null;
  attempts: number | null;
  max_attempts: number | null;
  children_total: number;
  children_done: number;
  children_failed: number;
  children_running: number;
  children_queued: number;
  progress_pct: number | null;
  eta_seconds: number | null;
  stale_minutes: number | null;
}

function fmtEta(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function FanOutProgressCard() {
  const [rows, setRows] = useState<FanOutRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("v_admin_fanout_progress")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(80);
    setRows((data ?? []) as FanOutRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> Fan-Out Progress
          <span className="text-xs text-muted-foreground">— Live Step-Progress mit ETA</span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-6">Keine aktiven Steps</div>
          )}
          {rows.map((r) => {
            const pct = r.progress_pct ?? (r.children_total === 0 && r.step_status === "running" ? null : 0);
            const stale = (r.stale_minutes ?? 0) > 30;
            return (
              <div key={r.step_id} className="rounded border p-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <code className="text-[11px]">{r.step_key}</code>
                    <Badge variant="outline" className="text-[10px]">{r.step_status}</Badge>
                    {stale && <Badge className="bg-orange-500 text-white text-[10px]">stale {Math.round(r.stale_minutes ?? 0)}m</Badge>}
                    {r.children_failed > 0 && <Badge className="bg-red-600 text-white text-[10px]">{r.children_failed} failed</Badge>}
                  </div>
                  <div className="text-muted-foreground text-[10px] font-mono">{r.package_id.slice(0, 8)}</div>
                </div>
                {r.children_total > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span>{r.children_done} / {r.children_total} ({pct ?? 0}%)</span>
                      <span className="text-muted-foreground">
                        run: {r.children_running} · queued: {r.children_queued} · ETA: {fmtEta(r.eta_seconds)}
                      </span>
                    </div>
                    <Progress value={pct ?? 0} className="h-1.5" />
                  </>
                ) : (
                  <div className="text-[11px] text-muted-foreground">Single-Job · {r.attempts ?? 0}/{r.max_attempts ?? 0} attempts</div>
                )}
                {r.last_error && (
                  <div className="text-[10px] text-red-600 mt-1 truncate" title={r.last_error}>↳ {r.last_error}</div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
