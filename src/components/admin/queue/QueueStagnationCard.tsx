/**
 * QueueStagnationCard
 * ───────────────────
 * Priorisiert zwei Failure-Patterns:
 *   1. Stagnation: identische job_ids im Failed-Snapshot über ≥<threshold> Min
 *   2. REQUEUE_LOOP_KILLED: terminal markierte Jobs der letzten N Stunden
 *
 * Robust ggü. fehlenden Tabellen/Spalten: Wenn `queue_health_failed_snapshot`
 * oder `job_queue.last_error` in einem Environment fehlt, zeigt die UI einen
 * neutralen Hinweis statt zu crashen.
 *
 * Akzeptiert externe Filter (URL-State) für Cluster/Zeitraum/job_id.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Info, RefreshCcw, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

export type QueueCluster = "all" | "stagnation" | "loop";

export interface QueueStagnationFilters {
  jobId?: string;
  cluster?: QueueCluster;
  /** Minutes for stagnation threshold (default 30) */
  thresholdMin?: number;
  /** Hours lookback for loop detection (default 6) */
  lookbackHours?: number;
}

interface StagnantJob {
  job_id: string;
  first_seen: string;
  last_seen: string;
  occurrences: number;
  age_minutes: number;
}

interface RequeueLoopJob {
  job_id: string;
  job_type: string;
  package_id: string | null;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

type QueryError = { message: string; code?: string } | null;

function isMissingRelation(err: unknown): boolean {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? "";
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") && msg.includes("not") ||
    msg.includes("404")
  );
}

export function QueueStagnationCard({ filters = {} }: { filters?: QueueStagnationFilters } = {}) {
  const cluster: QueueCluster = filters.cluster ?? "all";
  const thresholdMin = filters.thresholdMin ?? 30;
  const lookbackHours = filters.lookbackHours ?? 6;
  const jobIdFilter = filters.jobId?.trim() ?? "";

  const stagnation = useQuery({
    queryKey: ["queue-stagnation", thresholdMin, lookbackHours],
    enabled: cluster !== "loop",
    queryFn: async (): Promise<{ rows: StagnantJob[]; error: QueryError }> => {
      try {
        const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("queue_health_failed_snapshot")
          .select("job_id,taken_at")
          .gte("taken_at", cutoff)
          .order("taken_at", { ascending: false })
          .limit(5000);
        if (error) {
          if (isMissingRelation(error)) {
            return { rows: [], error: { message: "queue_health_failed_snapshot nicht verfügbar", code: "missing_relation" } };
          }
          throw error;
        }
        const map = new Map<string, { first: string; last: string; n: number }>();
        for (const row of data ?? []) {
          const existing = map.get(row.job_id);
          if (!existing) {
            map.set(row.job_id, { first: row.taken_at, last: row.taken_at, n: 1 });
          } else {
            existing.n++;
            if (row.taken_at < existing.first) existing.first = row.taken_at;
            if (row.taken_at > existing.last) existing.last = row.taken_at;
          }
        }
        const now = Date.now();
        const out: StagnantJob[] = [];
        for (const [job_id, v] of map.entries()) {
          const ageMin = Math.floor((now - new Date(v.first).getTime()) / 60_000);
          if (v.n >= 2 && ageMin >= thresholdMin) {
            out.push({
              job_id,
              first_seen: v.first,
              last_seen: v.last,
              occurrences: v.n,
              age_minutes: ageMin,
            });
          }
        }
        return { rows: out.sort((a, b) => b.age_minutes - a.age_minutes).slice(0, 50), error: null };
      } catch (e) {
        return { rows: [], error: { message: (e as Error).message } };
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const loops = useQuery({
    queryKey: ["queue-requeue-loop", lookbackHours],
    enabled: cluster !== "stagnation",
    queryFn: async (): Promise<{ rows: RequeueLoopJob[]; error: QueryError }> => {
      try {
        const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("job_queue")
          .select("id,job_type,package_id,attempts,last_error,updated_at")
          .ilike("last_error", "%REQUEUE_LOOP_KILLED%")
          .gte("updated_at", cutoff)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (error) {
          if (isMissingRelation(error)) {
            return { rows: [], error: { message: "job_queue nicht verfügbar", code: "missing_relation" } };
          }
          throw error;
        }
        return {
          rows: (data ?? []).map((r) => ({
            job_id: r.id,
            job_type: r.job_type,
            package_id: r.package_id,
            attempts: r.attempts ?? 0,
            last_error: r.last_error,
            updated_at: r.updated_at,
          })),
          error: null,
        };
      } catch (e) {
        return { rows: [], error: { message: (e as Error).message } };
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const stagRows = stagnation.data?.rows ?? [];
  const loopRows = loops.data?.rows ?? [];
  const stagErr = stagnation.data?.error ?? null;
  const loopErr = loops.data?.error ?? null;

  const allHits = useMemo(() => {
    const items: Array<{
      kind: "stagnation" | "loop";
      job_id: string;
      title: string;
      subtitle: string;
      package_id?: string | null;
      severity: "high" | "medium";
    }> = [];
    if (cluster !== "loop") {
      for (const s of stagRows) {
        items.push({
          kind: "stagnation",
          job_id: s.job_id,
          title: `Stagnation · ${s.age_minutes}m · ${s.occurrences} Snapshots`,
          subtitle: `seit ${new Date(s.first_seen).toLocaleString()}`,
          severity: s.age_minutes >= 120 ? "high" : "medium",
        });
      }
    }
    if (cluster !== "stagnation") {
      for (const l of loopRows) {
        items.push({
          kind: "loop",
          job_id: l.job_id,
          title: `REQUEUE_LOOP_KILLED · ${l.job_type} · ${l.attempts} attempts`,
          subtitle: l.last_error?.slice(0, 140) ?? "",
          package_id: l.package_id,
          severity: "high",
        });
      }
    }
    if (jobIdFilter) {
      const f = jobIdFilter.toLowerCase();
      return items.filter((i) => i.job_id.toLowerCase().includes(f));
    }
    return items;
  }, [stagRows, loopRows, cluster, jobIdFilter]);

  const stagCount = cluster === "loop" ? 0 : stagRows.length;
  const loopCount = cluster === "stagnation" ? 0 : loopRows.length;
  const total = allHits.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Queue-Stagnation & REQUEUE-Loops
          <Badge variant="outline" className="ml-2 text-[10px]">
            {total} priorisiert
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => {
              void stagnation.refetch();
              void loops.refetch();
            }}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat
            icon={AlertTriangle}
            label={`Stagnation ≥${thresholdMin}m`}
            count={stagCount}
            tone={stagCount > 0 ? "destructive" : "muted"}
            disabled={cluster === "loop"}
          />
          <Stat
            icon={Repeat}
            label={`REQUEUE_LOOP (${lookbackHours}h)`}
            count={loopCount}
            tone={loopCount > 0 ? "destructive" : "muted"}
            disabled={cluster === "stagnation"}
          />
        </div>

        {(stagErr || loopErr) && (
          <div className="flex flex-wrap gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
            <Info className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5">
              {stagErr && (
                <div>
                  <strong>Stagnation</strong>: {stagErr.message}
                  {stagErr.code === "missing_relation" && " — Snapshot-Tabelle in diesem Environment nicht angelegt."}
                </div>
              )}
              {loopErr && (
                <div>
                  <strong>Loop-Detect</strong>: {loopErr.message}
                </div>
              )}
            </div>
          </div>
        )}

        {total === 0 && !stagErr && !loopErr && !stagnation.isLoading && !loops.isLoading && (
          <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            Keine Stagnation/Loop-Findings im aktuellen Fenster
            {jobIdFilter && ` (Filter job_id="${jobIdFilter}")`}.
          </p>
        )}

        {allHits.length > 0 && (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {allHits.slice(0, 50).map((h) => (
              <li
                key={`${h.kind}::${h.job_id}`}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  h.severity === "high"
                    ? "border-destructive/40 bg-destructive-bg-subtle"
                    : "border-amber-500/40 bg-amber-500/5"
                }`}
              >
                <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase tracking-wide">
                  {h.kind}
                </Badge>
                <span className="font-medium">{h.title}</span>
                <span className="text-muted-foreground">— {h.subtitle}</span>
                <Link
                  to={`/admin/v2/heal/jobs?job_id=${h.job_id}`}
                  className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                >
                  {h.job_id.slice(0, 8)}…
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  count,
  tone,
  disabled,
}: {
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  tone: "destructive" | "muted";
  disabled?: boolean;
}) {
  const cls = disabled
    ? "bg-muted/40 text-muted-foreground/60 line-through"
    : tone === "destructive"
    ? "bg-destructive-bg-subtle text-destructive"
    : "bg-muted text-muted-foreground";
  return (
    <div className={`flex items-center gap-2 rounded-md p-2 ${cls}`}>
      <Icon className="h-4 w-4" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-base font-semibold tabular-nums">{count}</span>
    </div>
  );
}
