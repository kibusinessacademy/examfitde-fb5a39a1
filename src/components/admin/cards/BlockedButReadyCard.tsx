import { useQuery } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Lock, ShieldAlert, FileWarning } from 'lucide-react';

export default function BlockedButReadyCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'blocked-but-ready'],
    queryFn: adminRpc.blockedButReady,
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-28" />;
  if (!data || (data.total_blocked_ready === 0 && data.total_integrity_anomalies === 0)) return null;

  return (
    <Card className="border-l-4 border-l-destructive">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          Status-Invariant-Verstöße
          <Badge variant="destructive" className="text-[10px] ml-auto">
            {data.total_blocked_ready + data.total_integrity_anomalies}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Blocked but ready */}
        {data.blocked_but_ready.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Lock className="h-3 w-3 text-destructive" />
              <span className="text-[11px] font-semibold text-foreground">
                Blocked trotz erfüllter Gates ({data.blocked_but_ready.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {data.blocked_but_ready.map((pkg: any) => (
                <Link
                  key={pkg.package_id}
                  to={`/admin/studio/${pkg.package_id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2 hover:bg-destructive/10 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground truncate">
                      {pkg.title || pkg.package_id.slice(0, 8)}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-destructive/30 text-destructive">
                        {pkg.blocked_reason || 'stale block'}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">
                        integrity✓ council✓ steps: {pkg.non_done_steps} offen
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Integrity anomalies */}
        {data.integrity_anomalies.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileWarning className="h-3 w-3 text-warning" />
              <span className="text-[11px] font-semibold text-foreground">
                Integrity-Materialisierung fehlgeschlagen ({data.integrity_anomalies.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {data.integrity_anomalies.map((a: any) => (
                <Link
                  key={a.package_id}
                  to={`/admin/studio/${a.package_id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning/5 p-2 hover:bg-warning/10 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 h-3.5",
                          a.anomaly === 'INTEGRITY_COMPLETED_WITHOUT_REPORT'
                            ? 'border-destructive/30 text-destructive'
                            : 'border-warning/30 text-warning'
                        )}
                      >
                        {a.anomaly === 'INTEGRITY_COMPLETED_WITHOUT_REPORT'
                          ? 'Report fehlt'
                          : 'Stale nach Publish'}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground font-mono">
                        {a.package_id.slice(0, 8)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {a.status} · {a.build_progress}%
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
