/**
 * QueueStagnationCard
 * ───────────────────
 * Priorisiert zwei Failure-Patterns:
 *   1. Stagnation: identische job_ids im Failed-Snapshot über ≥30 Min
 *   2. REQUEUE_LOOP_KILLED: terminal markierte Jobs der letzten 6h
 *
 * Verlinkt direkt zu /admin/v2/heal/job/<id> (oder Fallback zur Cockpit-Übersicht).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, RefreshCcw, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const STAGNATION_THRESHOLD_MIN = 30;
const LOOP_LOOKBACK_HOURS = 6;

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

export function QueueStagnationCard() {
  // Stagnation: gleiche job_id in mehreren Snapshots, älteste Erscheinung ≥30Min
  const stagnation = useQuery({
    queryKey: ["queue-stagnation", STAGNATION_THRESHOLD_MIN],
    queryFn: async (): Promise<StagnantJob[]> => {
      const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("queue_health_failed_snapshot")
        .select("job_id,taken_at")
        .gte("taken_at", cutoff)
        .order("taken_at", { ascending: false })
        .limit(5000);
      if (error) throw error;

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
        if (v.n >= 2 && ageMin >= STAGNATION_THRESHOLD_MIN) {
          out.push({
            job_id,
            first_seen: v.first,
            last_seen: v.last,
            occurrences: v.n,
            age_minutes: ageMin,
          });
        }
      }
      return out.sort((a, b) => b.age_minutes - a.age_minutes).slice(0, 50);
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const loops = useQuery({
    queryKey: ["queue-requeue-loop", LOOP_LOOKBACK_HOURS],
    queryFn: async (): Promise<RequeueLoopJob[]> => {
      const cutoff = new Date(Date.now() - LOOP_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("job_queue")
        .select("id,job_type,package_id,attempts,last_error,updated_at")
        .ilike("last_error", "%REQUEUE_LOOP_KILLED%")
        .gte("updated_at", cutoff)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        job_id: r.id,
        job_type: r.job_type,
        package_id: r.package_id,
        attempts: r.attempts ?? 0,
        last_error: r.last_error,
        updated_at: r.updated_at,
      }));
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const stagCount = stagnation.data?.length ?? 0;
  const loopCount = loops.data?.length ?? 0;
  const total = stagCount + loopCount;

  const allHits = useMemo(() => {
    const items: Array<{
      kind: "stagnation" | "loop";
      job_id: string;
      title: string;
      subtitle: string;
      package_id?: string | null;
      severity: "high" | "medium";
    }> = [];
    for (const s of stagnation.data ?? []) {
      items.push({
        kind: "stagnation",
        job_id: s.job_id,
        title: `Stagnation · ${s.age_minutes}m · ${s.occurrences} Snapshots`,
        subtitle: `seit ${new Date(s.first_seen).toLocaleString()}`,
        severity: s.age_minutes >= 120 ? "high" : "medium",
      });
    }
    for (const l of loops.data ?? []) {
      items.push({
        kind: "loop",
        job_id: l.job_id,
        title: `REQUEUE_LOOP_KILLED · ${l.job_type} · ${l.attempts} attempts`,
        subtitle: l.last_error?.slice(0, 140) ?? "",
        package_id: l.package_id,
        severity: "high",
      });
    }
    return items;
  }, [stagnation.data, loops.data]);

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
            label={`Stagnation ≥${STAGNATION_THRESHOLD_MIN}m`}
            count={stagCount}
            tone={stagCount > 0 ? "destructive" : "muted"}
          />
          <Stat
            icon={Repeat}
            label={`REQUEUE_LOOP (${LOOP_LOOKBACK_HOURS}h)`}
            count={loopCount}
            tone={loopCount > 0 ? "destructive" : "muted"}
          />
        </div>

        {total === 0 && !stagnation.isLoading && !loops.isLoading && (
          <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            Keine Stagnation/Loop-Findings im aktuellen Fenster.
          </p>
        )}

        {allHits.length > 0 && (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {allHits.slice(0, 30).map((h) => (
              <li
                key={`${h.kind}::${h.job_id}`}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  h.severity === "high"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-amber-500/40 bg-amber-500/5"
                }`}
              >
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[10px] uppercase tracking-wide"
                >
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
}: {
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  tone: "destructive" | "muted";
}) {
  const cls =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <div className={`flex items-center gap-2 rounded-md p-2 ${cls}`}>
      <Icon className="h-4 w-4" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-base font-semibold tabular-nums">{count}</span>
    </div>
  );
}
