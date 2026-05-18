/**
 * PreHeartbeatKillForensicsCard — S5b
 *
 * Tiefenforensik der PRE_HEARTBEAT_KILL Welle: Cluster nach Job-Type/Lane/Pool,
 * Top-betroffene Pakete, letzte 25 Kill-Events mit Heartbeat/Invocation-Daten,
 * sowie aktive Quarantäne-Pakete. Selektives Requeue mit Pflicht-Reason —
 * KEIN Bulk-Reset.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertTriangle, HeartCrack, Stethoscope, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Cluster {
  job_type: string;
  lane: string;
  worker_pool: string;
  phk_1h: number;
  phk_24h: number;
  phk_terminal_24h: number;
  distinct_packages_24h: number;
  last_kill_at: string | null;
}
interface TopPkg {
  package_id: string;
  title: string | null;
  package_key: string | null;
  phk_24h: number;
  terminal_24h: number;
  last_kill_at: string | null;
}
interface RecentKill {
  job_id: string;
  job_type: string;
  lane: string | null;
  worker_pool: string | null;
  package_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  attempts: number;
  killed_at: string | null;
  locked_at: string | null;
  first_heartbeat_at: string | null;
  heartbeat_count: number | null;
  edge_invocation_id: string | null;
  phk_count: number;
}
interface Quarantined {
  package_id: string;
  title: string | null;
  package_key: string | null;
  occurrences: number | null;
  activated_at: string | null;
}
interface Forensics {
  generated_at: string;
  clusters: Cluster[];
  top_packages_24h: TopPkg[];
  recent_kills: RecentKill[];
  quarantined_packages: Quarantined[];
}

function fmtAge(ts: string | null) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function PreHeartbeatKillForensicsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["phk-forensics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_pre_heartbeat_kill_forensics" as any,
      );
      if (error) throw error;
      return data as Forensics;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [target, setTarget] = useState<{ packageId?: string; jobId?: string } | null>(null);
  const [reason, setReason] = useState("");

  const requeue = useMutation({
    mutationFn: async (vars: { packageId?: string; jobId?: string; reason: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_requeue_pre_heartbeat_quarantine" as any,
        {
          p_package_id: vars.packageId ?? null,
          p_job_id: vars.jobId ?? null,
          p_reason: vars.reason,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(
        `Requeue ok — quarantine_cleared=${d?.quarantine_cleared} job_requeued=${d?.job_requeued}`,
      );
      qc.invalidateQueries({ queryKey: ["phk-forensics"] });
      qc.invalidateQueries({ queryKey: ["pre-heartbeat-kill-risk"] });
      setTarget(null);
      setReason("");
    },
    onError: (e: any) => toast.error(`Requeue failed: ${e.message}`),
  });

  const severity = useMemo(() => {
    if (!q.data) return "ok" as const;
    const terminal = q.data.clusters.reduce((s, c) => s + (c.phk_terminal_24h || 0), 0);
    const recent = q.data.clusters.reduce((s, c) => s + (c.phk_1h || 0), 0);
    if (terminal > 0) return "critical" as const;
    if (recent > 0) return "warn" as const;
    return "ok" as const;
  }, [q.data]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-text-secondary" />
            <h3 className="text-base font-semibold">Pre-Heartbeat Kill — Forensik (24h)</h3>
            <Badge
              variant={
                severity === "critical" ? "destructive" : severity === "warn" ? "secondary" : "outline"
              }
            >
              {severity.toUpperCase()}
            </Badge>
          </div>
          <p className="text-sm text-text-secondary">
            Jobs, die zwischen Claim und erstem Heartbeat sterben. Cluster, Top-Pakete & letzte Events.
            Selektives Requeue mit Reason — kein Bulk-Reset.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : q.error ? (
        <div className="flex items-center gap-2 text-status-error">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{(q.error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      ) : !q.data ? null : (
        <div className="space-y-5">
          {/* Clusters */}
          <section>
            <h4 className="text-sm font-medium mb-2">Cluster</h4>
            {q.data.clusters.length === 0 ? (
              <p className="text-sm text-text-secondary">Keine PHK-Events in 24h.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-secondary">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Job-Type</th>
                      <th className="py-1 pr-3">Lane</th>
                      <th className="py-1 pr-3">Pool</th>
                      <th className="py-1 pr-3 text-right">1h</th>
                      <th className="py-1 pr-3 text-right">24h</th>
                      <th className="py-1 pr-3 text-right">Terminal</th>
                      <th className="py-1 pr-3 text-right">Pakete</th>
                      <th className="py-1 pr-3">Letzter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.clusters.map((c) => (
                      <tr key={`${c.job_type}-${c.lane}-${c.worker_pool}`} className="border-t border-border-subtle">
                        <td className="py-1 pr-3 font-mono text-xs">{c.job_type}</td>
                        <td className="py-1 pr-3">{c.lane}</td>
                        <td className="py-1 pr-3">{c.worker_pool}</td>
                        <td className="py-1 pr-3 text-right">{c.phk_1h}</td>
                        <td className="py-1 pr-3 text-right">{c.phk_24h}</td>
                        <td className="py-1 pr-3 text-right">
                          {c.phk_terminal_24h > 0 ? (
                            <Badge variant="destructive">{c.phk_terminal_24h}</Badge>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td className="py-1 pr-3 text-right">{c.distinct_packages_24h}</td>
                        <td className="py-1 pr-3">{fmtAge(c.last_kill_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Quarantined */}
          {q.data.quarantined_packages.length > 0 && (
            <section>
              <h4 className="text-sm font-medium mb-2">In Quarantäne</h4>
              <div className="space-y-1">
                {q.data.quarantined_packages.map((p) => (
                  <div
                    key={p.package_id}
                    className="flex items-center justify-between gap-2 p-2 rounded bg-surface-sunken border border-border-subtle"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{p.title ?? p.package_id}</div>
                      <div className="text-xs text-text-secondary">
                        {p.package_key} · occ={p.occurrences ?? "—"} · seit {fmtAge(p.activated_at)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTarget({ packageId: p.package_id })}
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1" />
                      Quarantäne lösen
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent kills */}
          <section>
            <h4 className="text-sm font-medium mb-2">Letzte Kill-Events (max 25)</h4>
            {q.data.recent_kills.length === 0 ? (
              <p className="text-sm text-text-secondary">Keine Kill-Events.</p>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="text-text-secondary sticky top-0 bg-surface">
                    <tr className="text-left">
                      <th className="py-1 pr-2">Wann</th>
                      <th className="py-1 pr-2">Job-Type</th>
                      <th className="py-1 pr-2">Code</th>
                      <th className="py-1 pr-2">PHK#</th>
                      <th className="py-1 pr-2">HB</th>
                      <th className="py-1 pr-2">Invocation</th>
                      <th className="py-1 pr-2">Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.recent_kills.map((k) => (
                      <tr key={k.job_id} className="border-t border-border-subtle align-top">
                        <td className="py-1 pr-2 whitespace-nowrap">{fmtAge(k.killed_at)}</td>
                        <td className="py-1 pr-2 font-mono">{k.job_type}</td>
                        <td className="py-1 pr-2">
                          {k.last_error_code === "PRE_HEARTBEAT_KILL_TERMINAL" ? (
                            <Badge variant="destructive" className="text-[10px]">
                              TERMINAL
                            </Badge>
                          ) : (
                            <span>PRE_HB_KILL</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right">{k.phk_count}</td>
                        <td className="py-1 pr-2 text-right">
                          {k.first_heartbeat_at ? `+${k.heartbeat_count ?? 0}` : "—"}
                        </td>
                        <td className="py-1 pr-2 font-mono truncate max-w-[160px]">
                          {k.edge_invocation_id ?? "—"}
                        </td>
                        <td className="py-1 pr-2">
                          {k.last_error_code === "PRE_HEARTBEAT_KILL_TERMINAL" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setTarget({
                                  jobId: k.job_id,
                                  packageId: k.package_id ?? undefined,
                                })
                              }
                            >
                              Requeue
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartCrack className="h-5 w-5" />
              PHK-Quarantäne lösen
            </DialogTitle>
            <DialogDescription>
              {target?.jobId
                ? `Job ${target.jobId.slice(0, 8)}… wird wieder eingereiht.`
                : `Paket ${target?.packageId?.slice(0, 8)}… Quarantäne-Flag wird entfernt.`}{" "}
              Pflicht-Reason (≥5 Zeichen). Audit in auto_heal_log.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="z.B. Worker-Fix deployed, manuelle Verifizierung"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={reason.trim().length < 5 || requeue.isPending}
              onClick={() =>
                target &&
                requeue.mutate({
                  packageId: target.packageId,
                  jobId: target.jobId,
                  reason: reason.trim(),
                })
              }
            >
              {requeue.isPending ? "…" : "Requeue ausführen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
