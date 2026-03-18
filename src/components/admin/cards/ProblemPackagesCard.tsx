import { useState, useMemo } from "react";
import { useProblemPackages, type ProblemFilter } from "@/components/admin/hooks/useProblemPackages";
import { adminRpc } from "@/integrations/supabase/admin-rpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert, Wrench, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const FILTER_OPTIONS: { key: ProblemFilter; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "stale", label: "Progress-Drift" },
  { key: "dead_ends", label: "Dead Ends" },
  { key: "blockers", label: "Blocker ≥2" },
];

const BAND_COLORS: Record<string, string> = {
  learner_ready: "border-emerald-500/30 text-emerald-400",
  content_heavy: "border-sky-500/30 text-sky-400",
  building: "border-amber-500/30 text-amber-400",
  early: "border-border text-muted-foreground",
  empty: "border-border text-muted-foreground",
};

const ARTIFACT_LABELS: Record<string, string> = {
  content: "Content",
  minichecks: "MC",
  qc: "QC",
  exam_pool: "Exam",
  handbook: "HB",
};

const DEAD_END_LABELS: Record<string, string> = {
  lessons_empty: "Lessons ∅",
  minichecks_dead_end: "MC ∅",
  exam_training_dead_end: "Exam ∅",
  handbook_dead_end: "HB ∅",
};

export function ProblemPackagesCard() {
  const { data, isLoading } = useProblemPackages();
  const [filter, setFilter] = useState<ProblemFilter>("all");
  const [repairing, setRepairing] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const filtered = useMemo(() => {
    if (!data) return [];
    switch (filter) {
      case "stale":
        return data.filter((p) => p.likely_stale_progress);
      case "dead_ends":
        return data.filter((p) => p.dead_ends?.length > 0);
      case "blockers":
        return data.filter((p) => p.blocker_count >= 2);
      default:
        return data;
    }
  }, [data, filter]);

  const handleRepair = async (packageId: string, title: string) => {
    setRepairing(packageId);
    try {
      const result = await adminRpc.triggerExamRebalance(packageId);
      if (result.ok) {
        const actionSummary = result.actions?.map((a) => a.type).join(", ") || "none";
        toast.success(`Repair gestartet: ${title}`, {
          description: `Aktionen: ${actionSummary}. Pipeline wird neu gestartet.`,
        });
        queryClient.invalidateQueries({ queryKey: ["admin"] });
      } else {
        toast.error("Repair fehlgeschlagen", { description: String((result as any).error || "Unbekannter Fehler") });
      }
    } catch (e) {
      toast.error("Repair fehlgeschlagen", { description: (e as Error).message });
    } finally {
      setRepairing(null);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!data) return null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Top Problem Packages
          </h3>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{filtered.length}</span>
      </div>

      {/* Filter row */}
      <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors border ${
              filter === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-t border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Paket</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground">Band</th>
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">Score</th>
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">Real%</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground">Drift</th>
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">B</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Fehlend</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Dead Ends</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 15).map((pkg) => {
              const isBlocked = pkg.status === "blocked";
              const isRepairing = repairing === pkg.package_id;

              return (
                <tr key={pkg.package_id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 max-w-[160px] truncate text-foreground font-medium" title={pkg.package_title}>
                    {pkg.package_title}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Badge variant="outline" className={`text-[9px] ${BAND_COLORS[pkg.readiness_band] ?? ""}`}>
                      {pkg.readiness_band?.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">{pkg.readiness_score}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">{pkg.real_progress}%</td>
                  <td className="px-2 py-2 text-center">
                    {pkg.likely_stale_progress && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mx-auto" />
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">
                    {pkg.blocker_count > 0 ? pkg.blocker_count : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-0.5">
                      {(pkg.missing_artifacts || []).map((a) => (
                        <span key={a} className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                          {ARTIFACT_LABELS[a] ?? a}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-0.5">
                      {(pkg.dead_ends || []).map((d) => (
                        <span key={d} className="rounded bg-destructive/10 px-1 py-0.5 text-[9px] text-destructive">
                          {DEAD_END_LABELS[d] ?? d}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isBlocked && (
                      <button
                        onClick={() => handleRepair(pkg.package_id, pkg.package_title)}
                        disabled={isRepairing}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                        title="Exam-Pool reparieren & Pipeline neu starten"
                      >
                        {isRepairing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wrench className="h-3 w-3" />
                        )}
                        Repair
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Keine Pakete in diesem Filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 15 && (
        <div className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border">
          +{filtered.length - 15} weitere Pakete
        </div>
      )}
    </div>
  );
}
