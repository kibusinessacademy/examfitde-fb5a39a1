/**
 * VariantPipelineHealthCard
 * ──────────────────────────
 * Forensik der Varianten-Approval-Pipeline.
 * Liest `admin_get_variant_pipeline_health()`. Read-only.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, Clock, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface AgingBucket {
  bucket: string;
  cnt: number;
}
interface StalledPkg {
  package_id: string;
  title: string;
  review_cnt: number;
  approved_cnt: number;
  approved_7d: number;
  oldest_review_sec: number;
  p95_review_age_sec: number;
}
interface LfHot {
  learning_field_id: string;
  lf_code: string | null;
  lf_title: string | null;
  review_cnt: number;
  approved_cnt: number;
  oldest_review_sec: number;
}
interface Health {
  snapshot_at: string;
  global: {
    review: number;
    approved: number;
    rejected: number;
    approved_1h: number;
    approved_24h: number;
    approved_7d: number;
    rejected_1h: number;
    rejected_24h: number;
    rejected_7d: number;
  };
  approved_per_hour_24h: number;
  projected_drain_hours: number | null;
  aging_buckets: AgingBucket[];
  validate_throughput: {
    completed_24h: number;
    completed_1h: number;
    failed_24h: number;
    cancelled_24h: number;
    avg_wait_sec_24h: number | null;
    avg_processing_sec_24h: number | null;
  };
  queue: {
    pending_validate: number;
    processing_validate: number;
    pending_promote: number;
    pending_generate: number;
    processing_generate: number;
  };
  top_stalled_packages: StalledPkg[];
  hottest_lf_bottlenecks: LfHot[];
}

const BUCKET_ORDER = ["<1h", "<6h", "<24h", "<7d", ">7d"];

function fmtSec(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
function fmtDrain(h: number | null): string {
  if (h == null) return "∞ (kein Durchsatz)";
  if (h < 24) return `${h.toFixed(1)} h`;
  if (h < 24 * 30) return `${(h / 24).toFixed(1)} Tage`;
  if (h < 24 * 365) return `${(h / 24 / 30).toFixed(1)} Monate`;
  return `${(h / 24 / 365).toFixed(1)} Jahre`;
}

export function VariantPipelineHealthCard() {
  const q = useQuery({
    queryKey: ["admin-variant-pipeline-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_variant_pipeline_health" as any,
      );
      if (error) throw error;
      return data as Health;
    },
    refetchInterval: 60_000,
  });

  if (q.isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }
  if (q.error || !q.data) {
    return (
      <Card className="p-4">
        <div className="text-sm text-destructive">
          Fehler beim Laden der Variant-Pipeline-Health.
        </div>
      </Card>
    );
  }

  const d = q.data;
  const drainCritical =
    d.projected_drain_hours == null || d.projected_drain_hours > 24 * 30;
  const maxAging = Math.max(1, ...d.aging_buckets.map((b) => b.cnt));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" /> Variant Pipeline Health
        </h3>
        <Badge
          variant={drainCritical ? "destructive" : "secondary"}
          className="text-[10px]"
        >
          Drain ETA: {fmtDrain(d.projected_drain_hours)}
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Review Backlog" value={d.global.review.toLocaleString()} tone="warn" />
        <Kpi
          label="Approved /h (24h)"
          value={d.approved_per_hour_24h.toFixed(2)}
          tone={d.approved_per_hour_24h > 0 ? "ok" : "crit"}
        />
        <Kpi
          label="Approved 24h"
          value={d.global.approved_24h.toLocaleString()}
          tone={d.global.approved_24h > 0 ? "ok" : "crit"}
        />
        <Kpi
          label="Rejected 24h"
          value={d.global.rejected_24h.toLocaleString()}
          tone="neutral"
        />
      </div>

      {/* Aging histogram */}
      <div>
        <div className="text-xs font-semibold mb-1.5 flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Review Aging
        </div>
        <div className="space-y-1">
          {BUCKET_ORDER.map((bk) => {
            const row = d.aging_buckets.find((b) => b.bucket === bk);
            const cnt = row?.cnt ?? 0;
            const pct = (cnt / maxAging) * 100;
            const crit = bk === ">7d" && cnt > 0;
            const warn = bk === "<7d" && cnt > 0;
            return (
              <div key={bk} className="flex items-center gap-2 text-xs">
                <div className="w-12 font-mono text-muted-foreground">{bk}</div>
                <div className="flex-1 h-4 rounded bg-muted/40 overflow-hidden">
                  <div
                    className={cn(
                      "h-full",
                      crit ? "bg-destructive" : warn ? "bg-warning" : "bg-primary/70",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-16 text-right tabular-nums font-bold">
                  {cnt.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validate throughput + queue */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-border p-2.5">
          <div className="font-semibold mb-1">Validate Worker (24h)</div>
          <div className="text-muted-foreground space-y-0.5">
            <div>Completed: <span className="text-foreground font-bold">{d.validate_throughput.completed_24h}</span> ({d.validate_throughput.completed_1h} /1h)</div>
            <div>Failed: {d.validate_throughput.failed_24h} · Cancelled: {d.validate_throughput.cancelled_24h}</div>
            <div>Wait Ø: {fmtSec(d.validate_throughput.avg_wait_sec_24h)} · Proc Ø: {fmtSec(d.validate_throughput.avg_processing_sec_24h)}</div>
          </div>
        </div>
        <div className="rounded-lg border border-border p-2.5">
          <div className="font-semibold mb-1">Queue Saturation</div>
          <div className="text-muted-foreground space-y-0.5">
            <div>Validate: <span className="text-foreground">{d.queue.pending_validate} pend / {d.queue.processing_validate} proc</span></div>
            <div>Promote: {d.queue.pending_promote} pending</div>
            <div>Generate: {d.queue.pending_generate} pend / {d.queue.processing_generate} proc</div>
          </div>
        </div>
      </div>

      {/* Stalled packages */}
      <div>
        <div className="text-xs font-semibold mb-1.5 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" /> Top Stalled Packages
        </div>
        {d.top_stalled_packages.length === 0 ? (
          <div className="text-xs text-muted-foreground">Keine.</div>
        ) : (
          <div className="space-y-1">
            {d.top_stalled_packages.map((p) => (
              <div
                key={p.package_id}
                className="flex items-center justify-between text-xs border-b border-border/40 pb-1"
              >
                <div className="truncate flex-1 mr-2">
                  <span className="font-medium">{p.title}</span>
                  <span className="text-muted-foreground ml-2 font-mono text-[10px]">
                    {p.package_id.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {p.review_cnt.toLocaleString()} review
                  </Badge>
                  <span className="text-muted-foreground">
                    +{p.approved_7d}/7d · oldest {fmtSec(p.oldest_review_sec)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hot LFs */}
      <div>
        <div className="text-xs font-semibold mb-1.5 flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> Hottest LF Bottlenecks
        </div>
        {d.hottest_lf_bottlenecks.length === 0 ? (
          <div className="text-xs text-muted-foreground">Keine.</div>
        ) : (
          <div className="space-y-1">
            {d.hottest_lf_bottlenecks.map((lf) => (
              <div
                key={lf.learning_field_id}
                className="flex items-center justify-between text-xs border-b border-border/40 pb-1"
              >
                <div className="truncate flex-1 mr-2">
                  <span className="font-mono text-[10px] text-muted-foreground mr-1">
                    {lf.lf_code ?? "—"}
                  </span>
                  <span>{lf.lf_title ?? lf.learning_field_id.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {lf.review_cnt.toLocaleString()} review
                  </Badge>
                  <span className="text-muted-foreground">
                    {lf.approved_cnt} appr · {fmtSec(lf.oldest_review_sec)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground">
        Snapshot: {new Date(d.snapshot_at).toLocaleString("de-DE")}
      </div>
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "crit" | "neutral";
}) {
  const toneCls = {
    ok: "border-success/30 bg-success-bg-subtle",
    warn: "border-warning/30 bg-warning-bg-subtle",
    crit: "border-destructive/30 bg-destructive-bg-subtle",
    neutral: "border-border bg-card",
  }[tone];
  return (
    <div className={cn("rounded-lg border p-2.5", toneCls)}>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
        {label}
      </div>
    </div>
  );
}
