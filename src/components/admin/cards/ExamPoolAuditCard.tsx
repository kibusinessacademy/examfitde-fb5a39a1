import { useQuery } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, ArrowRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

const diagnosisLabels: Record<string, { label: string; tone: 'red' | 'yellow' | 'green' }> = {
  compatible_unapproved: { label: 'Validierbar, nicht approved', tone: 'yellow' },
  lifecycle_drift: { label: 'Lifecycle-Drift', tone: 'red' },
  draft_only: { label: 'Nur Drafts', tone: 'red' },
  unknown: { label: 'Unbekannt', tone: 'red' },
};

export default function ExamPoolAuditCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'exam-pool-audit'],
    queryFn: () => adminRpc.examPoolAudit(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const packages = data?.packages ?? [];
  const guardEvents = data?.guard_events ?? [];

  if (packages.length === 0 && guardEvents.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Drift packages */}
      {packages.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              {packages.length} Paket(e) mit Exam-Pool-Drift
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">
            generate_exam_pool nicht done, aber Fragen existieren.
          </p>
          <div className="space-y-2">
            {packages.slice(0, 8).map(pkg => {
              const diag = diagnosisLabels[pkg.diagnosis] ?? diagnosisLabels.unknown;
              return (
                <Link
                  key={pkg.package_id}
                  to={`/admin/studio/${pkg.package_id}`}
                  className="block rounded-lg border border-border bg-card p-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {pkg.package_title ?? pkg.package_id.slice(0, 12)}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {pkg.package_id.slice(0, 8)} · Step: {pkg.step_status}
                      </div>
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 h-4",
                        diag.tone === 'red'
                          ? 'border-destructive/40 text-destructive bg-destructive/5'
                          : 'border-warning/40 text-warning bg-warning/5'
                      )}
                    >
                      {diag.label}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-border text-muted-foreground">
                      {pkg.total} Fragen
                    </Badge>
                    {pkg.review > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary">
                        {pkg.review} review
                      </Badge>
                    )}
                    {pkg.approved > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-success/30 text-success">
                        {pkg.approved} approved
                      </Badge>
                    )}
                    {pkg.tier1_passed > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/30 text-warning">
                        {pkg.tier1_passed} tier1
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Deadlock Guard Events */}
      {guardEvents.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              Deadlock-Guard Aktivierungen
            </span>
          </div>
          <div className="space-y-1.5">
            {guardEvents.slice(0, 5).map(evt => {
              const meta = evt.metadata as Record<string, unknown> | null;
              const diagnosis = (meta?.diagnosis as string) ?? '–';
              const compatible = (meta?.compatible_count as number) ?? 0;
              const drifted = (meta?.drifted_count as number) ?? 0;
              return (
                <div key={evt.id} className="rounded-lg border border-border bg-card p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">
                      {evt.target_id?.slice(0, 8) ?? '–'}
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(evt.created_at), { addSuffix: true, locale: de })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary">
                      {diagnosis}
                    </Badge>
                    {compatible > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-success/30 text-success">
                        {compatible} kompatibel
                      </Badge>
                    )}
                    {drifted > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/30 text-warning">
                        {drifted} gedrifted
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}