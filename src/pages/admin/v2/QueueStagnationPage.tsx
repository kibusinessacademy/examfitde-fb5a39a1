/**
 * QueueStagnationPage
 * ───────────────────
 * Filter (job_id, Cluster, Zeitraum) werden in der URL als Query-Parameter
 * gespeichert (?job_id=…&cluster=…&threshold=…&lookback=…), damit Filter
 * über Refreshes/Deep-Links erhalten bleiben.
 */
import { useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  QueueStagnationCard,
  type QueueCluster,
  type QueueStagnationFilters,
} from "@/components/admin/queue/QueueStagnationCard";
import { JobLiveProgressList } from "@/components/admin/queue/JobLiveProgressList";

const CLUSTERS: { value: QueueCluster; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "stagnation", label: "Stagnation" },
  { value: "loop", label: "REQUEUE-Loop terminal" },
];

const TIMEFRAMES: { hours: number; label: string }[] = [
  { hours: 1, label: "1h" },
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 72, label: "72h" },
];

export default function QueueStagnationPage() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<QueueStagnationFilters>(() => {
    const cluster = (params.get("cluster") as QueueCluster) || "all";
    const lookbackHours = Number(params.get("lookback") ?? "6") || 6;
    const thresholdMin = Number(params.get("threshold") ?? "30") || 30;
    const jobId = params.get("job_id") ?? "";
    return {
      cluster: ["all", "stagnation", "loop"].includes(cluster) ? cluster : "all",
      lookbackHours,
      thresholdMin,
      jobId,
    };
  }, [params]);

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const activeFilters: string[] = [];
  if (filters.jobId) activeFilters.push(`job_id≈${filters.jobId.slice(0, 12)}`);
  if (filters.cluster && filters.cluster !== "all") activeFilters.push(`cluster=${filters.cluster}`);
  if (filters.lookbackHours !== 6) activeFilters.push(`lookback=${filters.lookbackHours}h`);
  if (filters.thresholdMin !== 30) activeFilters.push(`threshold=${filters.thresholdMin}m`);

  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">
      <Helmet>
        <title>Queue-Stagnation · Admin</title>
        <meta
          name="description"
          content="Priorisiert stagnierende Failed-Queue-Jobs (≥30 Min identische job_ids) und REQUEUE_LOOP_KILLED-Cluster. Filter werden in der URL gespeichert."
        />
      </Helmet>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Queue-Stagnation & REQUEUE-Loops</h1>
        <p className="text-xs text-muted-foreground">
          Identische Failed-Jobs ≥{filters.thresholdMin} Min und terminal markierte Loop-Jobs ({filters.lookbackHours}h-Fenster).
        </p>
      </header>

      {/* Filter-Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={filters.jobId ?? ""}
          onChange={(e) => update({ job_id: e.target.value })}
          placeholder="job_id Substring…"
          className="h-7 max-w-xs text-xs"
        />
        <select
          value={filters.cluster ?? "all"}
          onChange={(e) => update({ cluster: e.target.value === "all" ? "" : e.target.value })}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          aria-label="Cluster"
        >
          {CLUSTERS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={String(filters.lookbackHours ?? 6)}
          onChange={(e) => update({ lookback: e.target.value === "6" ? "" : e.target.value })}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          aria-label="Zeitraum"
        >
          {TIMEFRAMES.map((t) => (
            <option key={t.hours} value={String(t.hours)}>
              Zeitraum {t.label}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={1}
          value={String(filters.thresholdMin ?? 30)}
          onChange={(e) => update({ threshold: e.target.value === "30" ? "" : e.target.value })}
          className="h-7 w-24 text-xs"
          aria-label="Stagnation-Schwelle (Min)"
          title="Stagnation-Schwelle in Minuten"
        />
        {activeFilters.length > 0 && (
          <>
            {activeFilters.map((f) => (
              <Badge key={f} variant="outline" className="h-5 px-1 text-[10px]">
                {f}
              </Badge>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              <X className="mr-1 h-3 w-3" /> Filter zurücksetzen
            </Button>
          </>
        )}
      </div>

      <QueueStagnationCard filters={filters} />
    </div>
  );
}
