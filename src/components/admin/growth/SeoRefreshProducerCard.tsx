import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Play } from "lucide-react";
import { toast } from "sonner";

/**
 * SEO Knowledge OS — Cut B: Refresh Queue Producer Card.
 * Read-only summary over public.seo_refresh_queue + producer-run audit.
 * Detail: mem://strategie/seo-knowledge-os-audit-v1
 */

type StatusRow = { status: string; reason: string; count: number };
type RunRow = {
  created_at: string;
  payload: Record<string, unknown> | null;
  result_status: string | null;
};

export default function SeoRefreshProducerCard() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: byStatus, isLoading: loadingStatus } = useQuery({
    queryKey: ["seo-refresh-queue-by-status"],
    queryFn: async (): Promise<StatusRow[]> => {
      const { data, error } = await supabase
        .from("seo_refresh_queue")
        .select("status, reason")
        .limit(5000);
      if (error) throw error;
      const map = new Map<string, StatusRow>();
      (data ?? []).forEach((r: { status: string | null; reason: string | null }) => {
        const k = `${r.status ?? "pending"}|${r.reason ?? "—"}`;
        const cur = map.get(k);
        if (cur) cur.count += 1;
        else map.set(k, { status: r.status ?? "pending", reason: r.reason ?? "—", count: 1 });
      });
      return Array.from(map.values()).sort((a, b) => b.count - a.count);
    },
    staleTime: 30_000,
  });

  const { data: runs, isLoading: loadingRuns } = useQuery({
    queryKey: ["seo-refresh-producer-runs"],
    queryFn: async (): Promise<RunRow[]> => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("created_at, payload, result_status")
        .eq("action_type", "seo_refresh_queue_producer_run")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as RunRow[];
    },
    staleTime: 30_000,
  });

  const totals = (byStatus ?? []).reduce(
    (acc, r) => {
      acc.total += r.count;
      acc[r.status] = (acc[r.status] ?? 0) + r.count;
      return acc;
    },
    { total: 0 } as Record<string, number>,
  );

  async function handleRun() {
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc(
        "admin_enqueue_seo_refresh_candidates" as never,
        { _limit: 50 } as never,
      );
      if (error) throw error;
      const summary = data as { enqueued?: number; skipped_existing?: number } | null;
      toast.success(
        `Enqueued ${summary?.enqueued ?? 0} · skipped ${summary?.skipped_existing ?? 0}`,
      );
      qc.invalidateQueries({ queryKey: ["seo-refresh-queue-by-status"] });
      qc.invalidateQueries({ queryKey: ["seo-refresh-producer-runs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Producer-Lauf fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              SEO Refresh Producer
            </CardTitle>
            <CardDescription>
              Deterministischer Bridge-Producer aus <code>v_seo_content_node_ssot</code> in die
              bestehende <code>seo_refresh_queue</code>. Cut B des Knowledge-OS.
            </CardDescription>
          </div>
          <Button onClick={handleRun} disabled={running} size="sm" className="gap-2">
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Refresh-Kandidaten enqueuen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Totals */}
        <div className="flex flex-wrap gap-2">
          {loadingStatus ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Badge variant="outline">Total: {totals.total ?? 0}</Badge>
              {["pending", "in_progress", "done", "failed"].map((s) => (
                <Badge key={s} variant={s === "failed" ? "destructive" : "secondary"}>
                  {s}: {totals[s] ?? 0}
                </Badge>
              ))}
            </>
          )}
        </div>

        {/* By status × reason */}
        <div className="rounded-md border border-border">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div className="col-span-3">Status</div>
            <div className="col-span-7">Reason</div>
            <div className="col-span-2 text-right">Count</div>
          </div>
          <div className="max-h-[280px] overflow-y-auto divide-y divide-border">
            {(byStatus ?? []).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Queue ist leer. Producer-Lauf starten oder Cron abwarten (täglich 03:41 UTC).
              </div>
            ) : (
              (byStatus ?? []).map((r) => (
                <div
                  key={`${r.status}|${r.reason}`}
                  className="grid grid-cols-12 gap-2 px-3 py-2 text-xs"
                >
                  <div className="col-span-3">
                    <Badge variant="outline" className="text-[10px]">
                      {r.status}
                    </Badge>
                  </div>
                  <div className="col-span-7 font-mono text-muted-foreground">{r.reason}</div>
                  <div className="col-span-2 text-right font-medium">{r.count}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent producer runs */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Letzte Producer-Runs (Audit)
          </div>
          <div className="rounded-md border border-border">
            <div className="max-h-[200px] overflow-y-auto divide-y divide-border">
              {loadingRuns ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : !runs || runs.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Noch keine Runs.
                </div>
              ) : (
                runs.map((r, i) => {
                  const p = (r.payload ?? {}) as Record<string, unknown>;
                  return (
                    <div key={i} className="px-3 py-2 text-xs flex items-center gap-3">
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {String(r.result_status ?? "—")}
                      </Badge>
                      <span className="text-muted-foreground">
                        scanned {String(p.scanned ?? 0)} · enqueued {String(p.enqueued ?? 0)} ·
                        skipped {String(p.skipped_existing ?? 0)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Producer-RPC <code>fn_enqueue_seo_refresh_candidates</code> · Cron{" "}
          <code>seo-refresh-queue-producer-daily</code> · Audit-Action{" "}
          <code>seo_refresh_queue_producer_run</code>.
        </p>
      </CardContent>
    </Card>
  );
}
