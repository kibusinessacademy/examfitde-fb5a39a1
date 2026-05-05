import { usePipelineHealth, type PipelineHealthData, type PipelineHealthBreakdown } from "@/hooks/usePipelineHealth";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  AlertTriangle,
  FileCheck,
  Layers,
  ShieldAlert,
  Activity,
} from "lucide-react";

function trafficColor(light: string) {
  if (light === "green") return "text-emerald-400";
  if (light === "yellow") return "text-amber-400";
  return "text-rose-400";
}

function trafficBg(light: string) {
  if (light === "green") return "bg-emerald-500/15 border-emerald-500/30";
  if (light === "yellow") return "bg-amber-500/15 border-amber-500/30";
  return "bg-rose-500/15 border-rose-500/30";
}

function ScoreHero({ score, light }: { score: number; light: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${trafficBg(light)} flex items-center gap-5`}>
      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
          <circle
            cx="18" cy="18" r="15.5" fill="none" strokeWidth="3"
            strokeDasharray={`${score * 0.975} 100`}
            strokeLinecap="round"
            className={trafficColor(light)}
          />
        </svg>
        <span className={`absolute text-xl font-bold ${trafficColor(light)}`}>{score}</span>
      </div>
      <div>
        <div className="text-lg font-semibold tracking-tight text-foreground">Pipeline Health</div>
        <div className="text-sm text-muted-foreground">
          {light === "green" ? "Stabil & produktionsreif" : light === "yellow" ? "Beobachtung empfohlen" : "Eingreifen erforderlich"}
        </div>
      </div>
    </div>
  );
}

function DimensionCard({
  icon,
  label,
  breakdown,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  breakdown: PipelineHealthBreakdown;
  detail: React.ReactNode;
}) {
  const pct = Math.round((breakdown.score / breakdown.max) * 100);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          {label}
        </div>
        <span className="text-sm font-semibold text-foreground">
          {breakdown.score}/{breakdown.max}
        </span>
      </div>
      <Progress value={pct} className="h-1.5 mb-3" />
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function QueueLatencyCard({ data }: { data: PipelineHealthData }) {
  const items = data.queue_latency;
  return (
    <DimensionCard
      icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      label="Queue Latency"
      breakdown={data.score.breakdown.queue_latency}
      detail={
        items.length === 0 ? (
          "Keine pending Jobs"
        ) : (
          <div className="space-y-1.5">
            {items.slice(0, 5).map((i) => (
              <div key={i.job_type} className="flex justify-between">
                <span className="truncate">{i.job_type}</span>
                <span className="shrink-0 ml-2 font-mono">
                  p90 {Math.round(i.p90_wait_seconds)}s · {i.pending_jobs} pending
                </span>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}

function StuckCard({ data }: { data: PipelineHealthData }) {
  const items = data.stuck_processing;
  const total = items.reduce((s, i) => s + i.stuck_jobs, 0);
  return (
    <DimensionCard
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      label="Stuck Processing"
      breakdown={data.score.breakdown.stuck_processing}
      detail={
        total === 0 ? (
          "0 Zombie-Jobs — sauber"
        ) : (
          <div className="space-y-1.5">
            {items.map((i) => (
              <div key={i.job_type} className="flex justify-between">
                <span className="truncate">{i.job_type}</span>
                <span className="shrink-0 ml-2 font-mono">
                  {i.stuck_jobs} stuck · max {Math.round(i.max_stale_seconds)}s
                </span>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}

function ContentCard({ data }: { data: PipelineHealthData }) {
  const items = data.content_integrity;
  return (
    <DimensionCard
      icon={<FileCheck className="h-4 w-4 text-muted-foreground" />}
      label="Content Integrity"
      breakdown={data.score.breakdown.content_integrity}
      detail={
        items.length === 0 ? (
          "Keine Building-Pakete"
        ) : (
          <div className="space-y-1.5">
            {items.slice(0, 6).map((i) => (
              <div key={i.package_id} className="flex items-center gap-2">
                <span className="truncate flex-1 min-w-0">{i.title}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${i.real_pct ?? 0}%` }}
                    />
                  </div>
                  <span className="font-mono w-10 text-right">{i.real_pct ?? 0}%</span>
                </div>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}

function StepFunnelCard({ data }: { data: PipelineHealthData }) {
  const items = data.step_funnel;
  const failedCount = items.filter((i) => i.status === "failed").length;
  return (
    <DimensionCard
      icon={<Layers className="h-4 w-4 text-muted-foreground" />}
      label="Step Progression"
      breakdown={data.score.breakdown.step_progression}
      detail={
        items.length === 0 ? (
          "Keine blockierten Steps"
        ) : (
          <div className="space-y-1.5">
            <div className="font-medium text-foreground text-[11px] mb-1">
              {failedCount} failed · {items.filter((i) => i.status === "blocked").length} blocked · {items.filter((i) => i.status === "queued").length} queued
            </div>
            {items
              .filter((i) => i.status === "failed")
              .slice(0, 4)
              .map((i, idx) => (
                <div key={`${i.package_id}-${i.step_key}-${idx}`} className="flex justify-between">
                  <span className="truncate">{i.title} → {i.step_key}</span>
                  <span className="shrink-0 ml-2 text-destructive">failed</span>
                </div>
              ))}
          </div>
        )
      }
    />
  );
}

function ErrorMixCard({ data }: { data: PipelineHealthData }) {
  const items = data.error_class;
  const permanent = items.filter((i) =>
    ["permission", "schema", "data_shape"].includes(i.error_class)
  );
  const transient = items.filter(
    (i) => !["permission", "schema", "data_shape"].includes(i.error_class)
  );
  return (
    <DimensionCard
      icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
      label="Error Mix (6h)"
      breakdown={data.score.breakdown.error_mix}
      detail={
        items.length === 0 ? (
          "Keine Fehler in den letzten 6h"
        ) : (
          <div className="space-y-1.5">
            {permanent.length > 0 && (
              <div className="text-destructive font-medium">
                ⚠ {permanent.reduce((s, i) => s + i.failed_cnt, 0)} permanente Fehler
              </div>
            )}
            {transient.map((i, idx) => (
              <div key={`${i.job_type}-${i.error_class}-${idx}`} className="flex justify-between">
                <span className="truncate">{i.error_class}</span>
                <span className="shrink-0 ml-2 font-mono">{i.failed_cnt}×</span>
              </div>
            ))}
          </div>
        )
      }
    />
  );
}

export default function PipelineHealthBoard() {
  const { data, isLoading, error } = usePipelineHealth();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data?.score) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive-bg-subtle p-6 text-sm text-destructive">
        Pipeline Health nicht verfügbar: {(error as Error)?.message ?? "Keine Daten"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity className="h-4 w-4" />
        <span>Pipeline Deep Health Monitor</span>
      </div>
      <ScoreHero score={data.score.total_score} light={data.score.traffic_light} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <QueueLatencyCard data={data} />
        <StuckCard data={data} />
        <ContentCard data={data} />
        <StepFunnelCard data={data} />
        <ErrorMixCard data={data} />
      </div>
    </div>
  );
}
