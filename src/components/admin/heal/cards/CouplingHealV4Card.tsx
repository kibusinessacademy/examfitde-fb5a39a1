/**
 * CouplingHealV4Card — Live-Dashboard für coupling_heal_v4 Supervisor.
 *
 * Datenquelle: SECURITY-DEFINER RPC `admin_get_coupling_heal_v4_runs`
 * Realtime: Postgres-Changes auf `coupling_heal_v4_runs` (Insert + Update).
 *
 * Zeigt:
 *  - Status-Badge je Run (succeeded / skipped / retried_succeeded / failed_transient /
 *    failed_structural / crashed / running)
 *  - Forensik-Snapshot (gap_sync_queued_no_job, mismatch_done_step_open_job, schema_drift)
 *  - Retry-Verkettung (retry_of)
 *  - Crash-Banner wenn jüngster Lauf nicht in {succeeded, skipped, retried_succeeded}
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ShieldAlert, RefreshCw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  processed_count: number;
  healed_count: number;
  errors_count: number;
  sqlstate: string | null;
  error_message: string | null;
  forensics: any;
  retry_of: string | null;
  triggered_by: string;
}

const OK_STATUSES = new Set(["succeeded", "skipped", "retried_succeeded"]);

function statusVariant(s: string): { label: string; tone: "ok" | "warn" | "crit" | "info"; Icon: any } {
  switch (s) {
    case "succeeded":         return { label: "succeeded",         tone: "ok",   Icon: CheckCircle2 };
    case "skipped":           return { label: "skipped",           tone: "ok",   Icon: CheckCircle2 };
    case "retried_succeeded": return { label: "retried · ok",      tone: "ok",   Icon: RefreshCw };
    case "failed_transient":  return { label: "failed · transient", tone: "warn", Icon: RefreshCw };
    case "failed_structural": return { label: "failed · structural",tone: "crit", Icon: ShieldAlert };
    case "crashed":           return { label: "crashed",           tone: "crit", Icon: AlertTriangle };
    case "running":           return { label: "running",           tone: "info", Icon: Activity };
    default:                  return { label: s,                   tone: "info", Icon: Activity };
  }
}

function fmtAgo(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function CouplingHealV4Card() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["coupling-heal-v4-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_coupling_heal_v4_runs" as any, { _limit: 30 });
      if (error) throw error;
      return (data ?? []) as Run[];
    },
    refetchInterval: 30_000,
  });

  // Realtime Refresh
  useEffect(() => {
    const ch = supabase
      .channel("coupling-heal-v4-runs-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "coupling_heal_v4_runs" }, () => {
        qc.invalidateQueries({ queryKey: ["coupling-heal-v4-runs"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const runs = q.data ?? [];
  const latest = runs[0];
  const crashed = latest && !OK_STATUSES.has(latest.status) && latest.status !== "running";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Coupling-Heal v4 · Live
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">cron */15m</Badge>
          <Badge variant="outline" className="text-[10px]">realtime</Badge>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {crashed && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive-bg-subtle p-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Letzter Lauf endete mit Status „{latest.status}"
              </div>
              {latest.error_message && (
                <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-destructive/90">
                  {latest.sqlstate ? `[${latest.sqlstate}] ` : ""}{latest.error_message}
                </pre>
              )}
            </div>
          )}

          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {runs.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">Noch keine Läufe protokolliert.</p>
            )}
            {runs.map((r) => {
              const v = statusVariant(r.status);
              const f = (r.forensics ?? {}) as any;
              const tone =
                v.tone === "crit" ? "border-destructive/50 bg-destructive-bg-subtle"
                : v.tone === "warn" ? "border-warning/50 bg-warning-bg-subtle"
                : v.tone === "info" ? "border-border bg-muted/20"
                : "border-border";
              return (
                <div key={r.id} className={cn("rounded-md border p-2 text-xs", tone)}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={v.tone === "crit" ? "destructive" : "outline"} className="text-[10px]">
                        <v.Icon className="h-3 w-3 mr-1" /> {v.label}
                      </Badge>
                      {r.retry_of && (
                        <Badge variant="outline" className="text-[10px]">retry</Badge>
                      )}
                      <span className="text-muted-foreground">
                        {fmtAgo(r.started_at)} ago · {r.duration_ms ?? "?"}ms · {r.triggered_by}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      proc {r.processed_count} · heal {r.healed_count} · err {r.errors_count}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <Forensic label="gap_sync" value={f?.gap_sync_queued_no_job} danger={(f?.gap_sync_queued_no_job ?? 0) > 50} />
                    <Forensic label="mismatch" value={f?.mismatch_done_step_open_job} danger={(f?.mismatch_done_step_open_job ?? 0) > 0} />
                    <Forensic
                      label="schema_drift"
                      value={f?.schema_drift?.error ? "err" : (typeof f?.schema_drift === "object" ? "ok" : String(f?.schema_drift ?? "—"))}
                      danger={!!f?.schema_drift?.error}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function Forensic({ label, value, danger }: { label: string; value: any; danger?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={cn("font-bold tabular-nums", danger && "text-destructive")}>
        {value ?? "—"}
      </div>
    </div>
  );
}
