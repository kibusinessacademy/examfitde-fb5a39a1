/**
 * JobLiveProgressList
 * ───────────────────
 * Live progress per job_id with started_at / heartbeat / locked_by.
 * Highlights ghost-finalization jobs (locked but never started or no
 * heartbeat) with a clear status badge and a one-click heal button.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Ghost, Heart, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { healZombieLockedJob, markRequeueLoopTerminal } from "@/lib/admin/queue/zombieHealApi";
import { toast } from "sonner";

interface LiveJob {
  id: string;
  job_type: string;
  package_id: string | null;
  status: string;
  attempts: number;
  locked_at: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  updated_at: string;
}

function classifyJob(j: LiveJob): {
  badge: string;
  tone: "ok" | "warn" | "ghost" | "loop";
  label: string;
} {
  if (j.last_error?.includes("REQUEUE_LOOP_KILLED")) {
    return { badge: "loop", tone: "loop", label: "REQUEUE-Loop terminal" };
  }
  if (
    (j.status === "processing" || j.status === "running") &&
    j.locked_at &&
    !j.last_heartbeat_at &&
    Date.now() - new Date(j.locked_at).getTime() > 10 * 60_000
  ) {
    return { badge: "ghost", tone: "ghost", label: "Ghost-Finalization" };
  }
  if (
    j.last_heartbeat_at &&
    Date.now() - new Date(j.last_heartbeat_at).getTime() > 5 * 60_000
  ) {
    return { badge: "stale", tone: "warn", label: "Stale Heartbeat" };
  }
  return { badge: "ok", tone: "ok", label: "Aktiv" };
}

function fmtAge(ts: string | null): string {
  if (!ts) return "–";
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

export function JobLiveProgressList() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const liveQuery = useQuery({
    queryKey: ["job-live-progress"],
    queryFn: async (): Promise<LiveJob[]> => {
      const { data, error } = await supabase
        .from("job_queue")
        .select(
          "id,job_type,package_id,status,attempts,locked_at,started_at,last_heartbeat_at,locked_by,last_error,updated_at",
        )
        .in("status", ["processing", "running"])
        .order("locked_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as LiveJob[];
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const heal = useMutation({
    mutationFn: (jobId: string) => healZombieLockedJob(jobId, "manual_ghost_heal"),
    onSuccess: (res, jobId) => {
      if (res.ok) {
        toast.success(`Job ${jobId.slice(0, 8)} geheilt${res.step_reset ? " (Step zurückgesetzt)" : ""}`);
        void qc.invalidateQueries({ queryKey: ["job-live-progress"] });
      } else {
        toast.error(`Heal fehlgeschlagen: ${res.error ?? "unknown"}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusyId(null),
  });

  const term = useMutation({
    mutationFn: (jobId: string) => markRequeueLoopTerminal(jobId, "requeue_loop_manual"),
    onSuccess: (res, jobId) => {
      if (res.ok) {
        toast.success(`Job ${jobId.slice(0, 8)} als manual_review_required terminal markiert`);
        void qc.invalidateQueries({ queryKey: ["job-live-progress"] });
      } else {
        toast.error(`Mark fehlgeschlagen: ${res.error ?? "unknown"}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusyId(null),
  });

  const rows = liveQuery.data ?? [];
  const ghostCount = useMemo(() => rows.filter((r) => classifyJob(r).tone === "ghost").length, [rows]);
  const staleCount = useMemo(() => rows.filter((r) => classifyJob(r).tone === "warn").length, [rows]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-primary" />
          Live-Progress aktive Jobs
          <Badge variant="outline" className="ml-2 text-[10px]">{rows.length} aktiv</Badge>
          {ghostCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              <Ghost className="mr-1 h-3 w-3" /> {ghostCount} Ghost
            </Badge>
          )}
          {staleCount > 0 && (
            <Badge className="bg-amber-500/20 text-amber-700 text-[10px]">
              {staleCount} stale HB
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => void liveQuery.refetch()}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {liveQuery.isLoading && (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade aktive Jobs…
          </div>
        )}
        {!liveQuery.isLoading && rows.length === 0 && (
          <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            Keine aktiven Jobs.
          </p>
        )}
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {rows.map((j) => {
            const cls = classifyJob(j);
            const isGhost = cls.tone === "ghost";
            const isLoop = cls.tone === "loop";
            return (
              <li
                key={j.id}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  isGhost
                    ? "border-destructive/50 bg-destructive/5"
                    : isLoop
                    ? "border-purple-500/40 bg-purple-500/5"
                    : cls.tone === "warn"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-border bg-card"
                }`}
              >
                <Badge
                  variant={isGhost || isLoop ? "destructive" : "outline"}
                  className="h-4 px-1 text-[10px] uppercase"
                >
                  {isGhost && <Ghost className="mr-1 h-3 w-3" />}
                  {isLoop && <ShieldAlert className="mr-1 h-3 w-3" />}
                  {cls.label}
                </Badge>
                <span className="font-mono text-[11px] text-primary">{j.id.slice(0, 8)}…</span>
                <span className="text-muted-foreground">{j.job_type}</span>
                <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Activity className="h-3 w-3" /> started: {fmtAge(j.started_at)}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Heart className="h-3 w-3" /> hb: {fmtAge(j.last_heartbeat_at)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  attempts: {j.attempts}
                </span>
                {j.locked_by && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {j.locked_by.slice(0, 18)}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {isGhost && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-[10px]"
                      disabled={busyId === j.id}
                      onClick={() => {
                        setBusyId(j.id);
                        heal.mutate(j.id);
                      }}
                    >
                      {busyId === j.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <AlertTriangle className="mr-1 h-3 w-3" /> Heal
                        </>
                      )}
                    </Button>
                  )}
                  {isLoop && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={busyId === j.id}
                      onClick={() => {
                        setBusyId(j.id);
                        term.mutate(j.id);
                      }}
                    >
                      Terminal
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
