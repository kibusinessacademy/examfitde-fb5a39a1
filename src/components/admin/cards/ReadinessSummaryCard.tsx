import { useReadinessSummary } from "@/components/admin/hooks/useReadinessSummary";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Layers,
  Package,
  Eye,
  AlertTriangle,
  Unplug,
} from "lucide-react";

const BAND_ITEMS = [
  { key: "learner_ready", label: "Learner Ready", icon: CheckCircle, color: "text-emerald-400" },
  { key: "content_heavy", label: "Content Heavy", icon: Layers, color: "text-sky-400" },
  { key: "building", label: "Building", icon: Package, color: "text-amber-400" },
  { key: "early", label: "Early", icon: Eye, color: "text-muted-foreground" },
] as const;

const DEAD_END_LABELS: Record<string, string> = {
  lessons_empty: "Lessons leer",
  minichecks_dead_end: "MiniChecks fehlen",
  exam_training_dead_end: "Exam Pool ↓",
  handbook_dead_end: "Handbook fehlt",
};

const BLOCKER_LABELS: Record<string, string> = {
  content: "Content",
  minichecks: "MiniChecks",
  qc: "QC",
  exam_pool: "Exam Pool",
  handbook: "Handbook",
};

export function ReadinessSummaryCard() {
  const { data, isLoading } = useReadinessSummary();

  if (isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (!data) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Package Readiness
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {data.total} Pakete
        </span>
      </div>

      {/* Band distribution */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {BAND_ITEMS.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
            <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
            <span className="text-xs text-muted-foreground flex-1">{label}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {(data as any)[key] ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* Stale progress alert */}
      {data.stale_count > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">
            {data.stale_count} Pakete mit Progress-Drift
          </span>
        </div>
      )}

      {/* Dead ends */}
      {data.top_dead_ends.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Unplug className="h-3 w-3 text-destructive" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Dead Ends</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {data.top_dead_ends.map(({ kind, count }) => (
              <Badge key={kind} variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                {DEAD_END_LABELS[kind] ?? kind} ({count})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Missing artifacts */}
      {data.top_blockers.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Package className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fehlende Artefakte</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {data.top_blockers.map(({ kind, count }) => (
              <Badge key={kind} variant="outline" className="text-[10px] border-border text-muted-foreground">
                {BLOCKER_LABELS[kind] ?? kind} ({count})
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
