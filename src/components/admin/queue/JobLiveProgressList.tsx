/**
 * JobLiveProgressList
 * ───────────────────
 * Live progress per job_id with started_at / heartbeat / locked_by.
 *
 * v1.2 hardening:
 *  - Concurrency guard (no overlapping fetches)
 *  - Polling jitter ±15% (avoid thundering herd)
 *  - Warning surface after 3+ consecutive refresh failures
 *  - i18n (de/en)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Ghost, Heart, Loader2, RefreshCcw, ShieldAlert, AlertCircle, Languages,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { healZombieLockedJob, markRequeueLoopTerminal } from "@/lib/admin/queue/zombieHealApi";
import { useLocale } from "@/lib/admin/queue/i18n";
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

function classifyJob(j: LiveJob, t: (k: any) => string): {
  badge: string;
  tone: "ok" | "warn" | "ghost" | "loop";
  label: string;
} {
  if (j.last_error?.includes("REQUEUE_LOOP_KILLED")) {
    return { badge: "loop", tone: "loop", label: t("live.label.loop") };
  }
  if (
    (j.status === "processing" || j.status === "running") &&
    j.locked_at &&
    !j.last_heartbeat_at &&
    Date.now() - new Date(j.locked_at).getTime() > 10 * 60_000
  ) {
    return { badge: "ghost", tone: "ghost", label: t("live.label.ghost") };
  }
  if (
    j.last_heartbeat_at &&
    Date.now() - new Date(j.last_heartbeat_at).getTime() > 5 * 60_000
  ) {
    return { badge: "stale", tone: "warn", label: t("live.label.stale") };
  }
  return { badge: "ok", tone: "ok", label: t("live.label.ok") };
}

function fmtAge(ts: string | null): string {
  if (!ts) return "–";
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

function basePollInterval(rows: LiveJob[]): number {
  if (rows.length === 0) return 60_000;
  const hasActive = rows.some((r) => {
    if (r.status !== "processing" && r.status !== "running") return false;
    if (!r.last_heartbeat_at) return false;
    return Date.now() - new Date(r.last_heartbeat_at).getTime() < 60_000;
  });
  if (hasActive) return 5_000;
  return 30_000;
}

/** ±15% jitter around base — avoids thundering herd against the queue. */
function withJitter(base: number): number {
  const factor = 0.85 + Math.random() * 0.3;
  return Math.round(base * factor);
}

export function JobLiveProgressList() {
  const qc = useQueryClient();
  const { t, locale, setLocale } = useLocale();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rows, setRows] = useState<LiveJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetchAt, setLastFetchAt] = useState<number>(Date.now());
  const [nextRefreshAt, setNextRefreshAt] = useState<number>(Date.now() + 15_000);
  const [now, setNow] = useState(Date.now());
  const [failureCount, setFailureCount] = useState(0);

  const inflightRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  // Concurrency-guarded fetch
  const fetchJobs = async () => {
    if (inflightRef.current) return; // skip overlap
    inflightRef.current = true;
    try {
      const { data, error } = await supabase
        .from("job_queue")
        .select(
          "id,job_type,package_id,status,attempts,locked_at,started_at,last_heartbeat_at,locked_by,last_error,updated_at",
        )
        .in("status", ["processing", "running"])
        .order("locked_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as LiveJob[]);
      setFailureCount(0);
      setLastFetchAt(Date.now());
    } catch (e) {
      setFailureCount((c) => c + 1);
      // eslint-disable-next-line no-console
      console.warn("[JobLiveProgressList] refresh failed", e);
    } finally {
      inflightRef.current = false;
      setIsLoading(false);
    }
  };

  // Schedule next fetch with jittered backoff
  const scheduleNext = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const base = basePollInterval(rows);
    const wait = withJitter(base);
    setNextRefreshAt(Date.now() + wait);
    timerRef.current = window.setTimeout(async () => {
      await fetchJobs();
      scheduleNext();
    }, wait);
  };

  useEffect(() => {
    void fetchJobs().then(scheduleNext);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute next when rows change (active/idle transitions)
  useEffect(() => {
    if (!isLoading) scheduleNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const heal = useMutation({
    mutationFn: (jobId: string) => healZombieLockedJob(jobId, "manual_ghost_heal"),
    onSuccess: (res, jobId) => {
      if (res.ok) {
        toast.success(`Job ${jobId.slice(0, 8)} ✓${res.step_reset ? " (step reset)" : ""}`);
        void qc.invalidateQueries({ queryKey: ["job-live-progress"] });
        void fetchJobs();
      } else {
        toast.error(`Heal: ${res.error ?? "unknown"}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusyId(null),
  });

  const term = useMutation({
    mutationFn: (jobId: string) => markRequeueLoopTerminal(jobId, "requeue_loop_manual"),
    onSuccess: (res, jobId) => {
      if (res.ok) {
        toast.success(`Job ${jobId.slice(0, 8)} → manual_review_required`);
        void fetchJobs();
      } else {
        toast.error(`Mark: ${res.error ?? "unknown"}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusyId(null),
  });

  const ghostCount = useMemo(() => rows.filter((r) => classifyJob(r, t).tone === "ghost").length, [rows, t]);
  const staleCount = useMemo(() => rows.filter((r) => classifyJob(r, t).tone === "warn").length, [rows, t]);
  const pollMs = basePollInterval(rows);
  const secondsLeft = Math.max(0, Math.ceil((nextRefreshAt - now) / 1000));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-primary" />
          {t("live.title")}
          <Badge variant="outline" className="ml-2 text-[10px]">{rows.length} {t("live.active")}</Badge>
          {ghostCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              <Ghost className="mr-1 h-3 w-3" /> {ghostCount} {t("live.ghost")}
            </Badge>
          )}
          {staleCount > 0 && (
            <Badge className="bg-amber-500/20 text-amber-700 text-[10px]">
              {staleCount} {t("live.staleHb")}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="text-[10px] font-mono"
            title={`${t("live.pollIntv")}: ${pollMs / 1000}s · last=${new Date(lastFetchAt).toLocaleTimeString()}`}
          >
            ⟳ {secondsLeft}s · {pollMs / 1000}s
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => {
              void fetchJobs().then(scheduleNext);
            }}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> {t("live.refresh")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={() => setLocale(locale === "de" ? "en" : "de")}
            title="toggle language"
          >
            <Languages className="mr-1 h-3 w-3" /> {locale.toUpperCase()}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {failureCount >= 3 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {t("live.warnRepeated")} ({failureCount}×)
          </div>
        )}
        {isLoading && (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("live.loading")}
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            {t("live.empty")}
          </p>
        )}
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {rows.map((j) => {
            const cls = classifyJob(j, t);
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
                          <AlertTriangle className="mr-1 h-3 w-3" /> {t("live.btn.heal")}
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
                      {t("live.btn.terminal")}
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
