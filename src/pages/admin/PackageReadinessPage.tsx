import { useState, useMemo } from "react";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  usePackageReadiness,
  usePackageStepReadiness,
  usePackageBlockers,
  type PackageReadinessRow,
} from "@/components/admin/hooks/usePackageReadiness";
import {
  Package,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Eye,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Layers,
  Target,
} from "lucide-react";

const BAND_CONFIG: Record<string, { label: string; color: string }> = {
  learner_ready: { label: "Learner Ready", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  content_heavy: { label: "Content Heavy", color: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  building: { label: "Building", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  early: { label: "Early", color: "bg-muted text-muted-foreground border-border" },
  empty: { label: "Empty", color: "bg-muted text-muted-foreground border-border" },
};

const STEP_ORDER = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];

function ReadinessBadge({ band }: { band: string }) {
  const cfg = BAND_CONFIG[band] || BAND_CONFIG.empty;
  return <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>;
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{value}%</span>
    </div>
  );
}

function StepDrilldown({ packageId }: { packageId: string }) {
  const { data, isLoading } = usePackageStepReadiness(packageId);
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data?.length) return <p className="text-xs text-muted-foreground p-2">Keine Step-Daten</p>;

  const sorted = [...data].sort(
    (a, b) => STEP_ORDER.indexOf(a.lesson_step) - STEP_ORDER.indexOf(b.lesson_step)
  );

  return (
    <div className="grid grid-cols-5 gap-2 p-3 bg-muted/30 rounded-xl">
      {sorted.map((s) => (
        <div key={s.lesson_step} className="rounded-lg border border-border bg-card p-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            {s.lesson_step.replace("_", " ")}
          </div>
          <div className="text-sm font-semibold text-foreground">{s.real_lessons}/{s.total_lessons}</div>
          <ScoreBar value={s.materialization_pct} />
          <div className="mt-1 flex justify-center gap-1">
            {s.qc_approved > 0 && (
              <span className="text-[9px] text-emerald-400">✓{s.qc_approved}</span>
            )}
            {s.qc_tier1_failed > 0 && (
              <span className="text-[9px] text-rose-400">✗{s.qc_tier1_failed}</span>
            )}
            {s.qc_pending > 0 && (
              <span className="text-[9px] text-muted-foreground">?{s.qc_pending}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PackageRow({ pkg }: { pkg: PackageReadinessRow }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">{pkg.package_title}</span>
            <ReadinessBadge band={pkg.readiness_band} />
            {pkg.blocked_reason && (
              <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                Blocked
              </Badge>
            )}
          </div>
          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
            <span>Score: <strong className="text-foreground">{pkg.readiness_score}</strong></span>
            <span>Mat: {pkg.materialization_pct}%</span>
            <span>QC: {pkg.qc_approved_pct}%</span>
            <span>Risk: {pkg.exam_risk_coverage_pct}%</span>
            <span>Steps: {pkg.learner_step_completeness_pct}%</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold tabular-nums text-foreground">{pkg.real_lessons}</div>
          <div className="text-[10px] text-muted-foreground">/{pkg.total_lessons} lessons</div>
        </div>
      </button>
      {open && <StepDrilldown packageId={pkg.package_id} />}
    </div>
  );
}

type FilterBand = "all" | "learner_ready" | "content_heavy" | "building" | "early";

export default function PackageReadinessPage() {
  const { data, isLoading, error } = usePackageReadiness();
  const { data: blockers } = usePackageBlockers();
  const [filter, setFilter] = useState<FilterBand>("all");

  const bandCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    data.forEach((p) => {
      map[p.readiness_band] = (map[p.readiness_band] || 0) + 1;
    });
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data;
    return data.filter((p) => p.readiness_band === filter);
  }, [data, filter]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  const totalBlockers = blockers?.length || 0;

  return (
    <>
      <AdminSectionHeader
        title="Package Readiness Audit"
        subtitle="Learner-Reife, Materialisierung, QC & Prüfungsorientierung je Paket"
      />

      {/* KPI Row */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label="Learner Ready"
          value={bandCounts.learner_ready || 0}
          icon={<CheckCircle className="h-4 w-4 text-emerald-400" />}
        />
        <KpiCard
          label="Content Heavy"
          value={bandCounts.content_heavy || 0}
          icon={<Layers className="h-4 w-4 text-sky-400" />}
        />
        <KpiCard
          label="Building"
          value={bandCounts.building || 0}
          icon={<Package className="h-4 w-4 text-amber-400" />}
        />
        <KpiCard
          label="Early"
          value={bandCounts.early || 0}
          icon={<Eye className="h-4 w-4 text-muted-foreground" />}
        />
        <KpiCard
          label="Active Blockers"
          value={totalBlockers}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
        />
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {(["all", "learner_ready", "content_heavy", "building", "early"] as FilterBand[]).map((band) => (
          <button
            key={band}
            onClick={() => setFilter(band)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
              filter === band
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {band === "all" ? "Alle" : BAND_CONFIG[band]?.label || band}
            {band !== "all" && ` (${bandCounts[band] || 0})`}
          </button>
        ))}
      </div>

      {/* Package List */}
      <div className="space-y-2">
        {filtered.map((pkg) => (
          <PackageRow key={pkg.package_id} pkg={pkg} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Keine Pakete in dieser Kategorie
          </div>
        )}
      </div>

      {/* Blockers Section */}
      {blockers && blockers.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-400" />
            Top Blockers ({blockers.length})
          </h3>
          <div className="space-y-2">
            {blockers.slice(0, 15).map((b) => (
              <div
                key={b.package_id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{b.package_title}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {b.blocker_placeholder_heavy && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">Placeholder ↑</Badge>
                    )}
                    {b.blocker_qc_bottleneck && (
                      <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-400">QC ↓</Badge>
                    )}
                    {b.blocker_step_incomplete && (
                      <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-400">Steps ↓</Badge>
                    )}
                    {b.blocker_exam_risk_low && (
                      <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-400">Risk ↓</Badge>
                    )}
                    {b.blocker_pipeline_blocked && (
                      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">Pipeline</Badge>
                    )}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-muted-foreground text-right">
                  Score {b.readiness_score}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
