import { useCompetencyBundleProgress } from '@/hooks/useCompetencyBundleProgress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Layers, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

export function CompetencyBundleProgress({ packageId }: { packageId: string }) {
  const { progress: p, loading } = useCompetencyBundleProgress(packageId);

  if (loading || p.bundles_total === 0) return null;

  const pct = p.bundles_total > 0
    ? Math.round((p.bundles_done / p.bundles_total) * 100)
    : 0;

  return (
    <div className="mt-1 px-2 py-1.5 rounded bg-muted/40 border border-border/30 space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        <Layers className="h-3 w-3 text-primary shrink-0" />
        <span className="font-medium text-foreground">Kompetenz-Bundles</span>
        <span className="text-muted-foreground ml-auto">
          {p.bundles_done}/{p.bundles_total}
        </span>
        <Badge variant="outline" className="text-[9px] h-4">{pct}%</Badge>
      </div>

      {/* Mini progress bar */}
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            p.bundles_failed > 0 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {p.bundles_active > 0 && (
          <span className="flex items-center gap-0.5">
            <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
            {p.bundles_active} aktiv
          </span>
        )}
        {p.bundles_done > 0 && (
          <span className="flex items-center gap-0.5">
            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
            {p.bundles_done} done
          </span>
        )}
        {p.bundles_failed > 0 && (
          <span className="flex items-center gap-0.5 text-destructive">
            <AlertTriangle className="h-2.5 w-2.5" />
            {p.bundles_failed} failed
          </span>
        )}
        {p.legacy_lessons > 0 && (
          <span className="text-orange-500">
            {p.legacy_lessons} legacy
          </span>
        )}
        {p.lesson_subjobs_total > 0 && (
          <span className="ml-auto">
            Lessons: {p.lesson_subjobs_done}/{p.lesson_subjobs_total}
          </span>
        )}
      </div>
    </div>
  );
}
