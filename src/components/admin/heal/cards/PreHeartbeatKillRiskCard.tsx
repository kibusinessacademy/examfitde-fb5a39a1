/**
 * PreHeartbeatKillRiskCard — S5
 *
 * Zeigt Job-Type × Lane × Pool Hot-Spots, deren Jobs zwischen Claim und
 * erstem Heartbeat sterben (PRE_HEARTBEAT_KILL). Datenquelle:
 * admin_get_pre_heartbeat_kill_risk (24h-Fenster).
 *
 * Severity:
 *  - critical: phk_terminal_24h > 0
 *  - warn:     phk_1h > 0
 *  - ok:       sonst
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, HeartCrack } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  job_type: string;
  lane: string;
  worker_pool: string;
  phk_1h: number;
  phk_24h: number;
  phk_terminal_24h: number;
  distinct_packages_24h: number;
  last_kill_at: string | null;
}

function fmtAge(ts: string | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function PreHeartbeatKillRiskCard() {
  const q = useQuery({
    queryKey: ["pre-heartbeat-kill-risk"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_pre_heartbeat_kill_risk" as any,
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const status = useMemo<"critical" | "warn" | "ok">(() => {
    const rows = q.data ?? [];
    if (rows.some((r) => (r.phk_terminal_24h ?? 0) > 0)) return "critical";
    if (rows.some((r) => (r.phk_1h ?? 0) > 0)) return "warn";
    return "ok";
  }, [q.data]);

  const totals = useMemo(() => {
    const rows = q.data ?? [];
    return {
      hotspots: rows.length,
      phk_1h: rows.reduce((s, r) => s + (r.phk_1h ?? 0), 0),
      phk_24h: rows.reduce((s, r) => s + (r.phk_24h ?? 0), 0),
      phk_terminal_24h: rows.reduce(
        (s, r) => s + (r.phk_terminal_24h ?? 0),
        0,
      ),
    };
  }, [q.data]);

  return (
    <Card
      className={cn(
        "p-4",
        status === "critical" && "border-destructive bg-destructive-bg-subtle",
        status === "warn" && "border-warning bg-warning-bg-subtle",
      )}
      data-testid="pre-heartbeat-kill-risk-card"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <HeartCrack
            className={cn(
              "h-4 w-4",
              status === "critical" && "text-destructive",
              status === "warn" && "text-warning",
              status === "ok" && "text-success",
            )}
          />
          Pre-Heartbeat Kill Risk (24h)
        </h3>
        <Badge variant="outline" className="text-[10px]">
          live · 60s
        </Badge>
      </div>

      <p className="text-[11px] text-muted-foreground mb-3">
        Jobs, die zwischen Claim und erstem Heartbeat sterben. Nach 2
        Vorkommen → terminale Quarantäne (Paket geschützt). Differenziert
        Edge-Function-CPU-Kills von echten Worker-Fehlern.
      </p>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <div className="text-xs text-destructive">
          Fehler: {(q.error as Error).message}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3 text-center">
            <Stat label="Hotspots" value={totals.hotspots} />
            <Stat label="PHK 1h" value={totals.phk_1h} tone={totals.phk_1h > 0 ? "warn" : "ok"} />
            <Stat label="PHK 24h" value={totals.phk_24h} />
            <Stat
              label="Terminal"
              value={totals.phk_terminal_24h}
              tone={totals.phk_terminal_24h > 0 ? "crit" : "ok"}
            />
          </div>

          {(q.data ?? []).length === 0 ? (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Keine Pre-Heartbeat-Kills in den letzten 24h.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-left">job_type</th>
                    <th className="p-2 text-left">lane</th>
                    <th className="p-2 text-left">pool</th>
                    <th className="p-2 text-right">1h</th>
                    <th className="p-2 text-right">24h</th>
                    <th className="p-2 text-right">terminal</th>
                    <th className="p-2 text-right">pkgs</th>
                    <th className="p-2 text-right">last</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data ?? []).map((r, i) => {
                    const crit = (r.phk_terminal_24h ?? 0) > 0;
                    return (
                      <tr key={`${r.job_type}-${r.lane}-${r.worker_pool}-${i}`} className="border-b">
                        <td className="p-2 font-mono text-[11px]">{r.job_type}</td>
                        <td className="p-2">{r.lane}</td>
                        <td className="p-2">{r.worker_pool}</td>
                        <td className="p-2 text-right tabular-nums">{r.phk_1h}</td>
                        <td className="p-2 text-right tabular-nums">{r.phk_24h}</td>
                        <td className="p-2 text-right tabular-nums">
                          {crit ? (
                            <Badge variant="destructive" className="text-[10px]">
                              <AlertTriangle className="h-3 w-3 mr-0.5" />
                              {r.phk_terminal_24h}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">{r.distinct_packages_24h}</td>
                        <td className="p-2 text-right tabular-nums">{fmtAge(r.last_kill_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn" | "crit";
}) {
  return (
    <div
      className={cn(
        "p-2 rounded-md border",
        tone === "crit" && "border-destructive bg-destructive-bg-subtle",
        tone === "warn" && "border-warning bg-warning-bg-subtle",
        tone === "ok" && "border-success/40",
        tone === "neutral" && "border-border bg-muted/20",
      )}
    >
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
