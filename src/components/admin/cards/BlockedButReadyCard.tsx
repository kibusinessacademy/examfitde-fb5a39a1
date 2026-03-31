import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Lock, ShieldAlert, FileWarning, Loader2, Unlock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

export default function BlockedButReadyCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'blocked-but-ready'],
    queryFn: adminRpc.blockedButReady,
    refetchInterval: 30_000,
  });

  const unblockMutation = useMutation({
    mutationFn: async (packageId: string) => {
      return runAdminOpsAction('unblock_package', { package_id: packageId, reason: 'Blocked-but-ready: Gates erfüllt, auto-unblock via Leitstelle' });
    },
    onSuccess: () => {
      toast.success('Paket entblockiert');
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });

  const integrityMutation = useMutation({
    mutationFn: async (packageId: string) => {
      return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: 'run_integrity_check' });
    },
    onSuccess: () => {
      toast.success('Integrity-Check gestartet');
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });

  if (isLoading) return <Skeleton className="h-28" />;
  if (!data || (data.total_blocked_ready === 0 && data.total_integrity_anomalies === 0)) return null;

  const busy = unblockMutation.isPending || integrityMutation.isPending;

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
                <div
                  key={pkg.package_id}
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/admin/studio/${pkg.package_id}`}
                      className="min-w-0 flex-1 hover:text-primary transition-colors"
                    >
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
                    </Link>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                  {/* Heal actions */}
                  <div className="flex gap-1.5 mt-2">
                    <Button
                      size="sm" variant="outline"
                      className="h-6 text-[10px] px-2 gap-1"
                      disabled={busy}
                      onClick={(e) => { e.preventDefault(); unblockMutation.mutate(pkg.package_id); }}
                    >
                      {unblockMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
                      Entblockieren
                    </Button>
                  </div>
                </div>
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
                <div
                  key={a.package_id}
                  className="rounded-lg border border-warning/20 bg-warning/5 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/admin/studio/${a.package_id}`}
                      className="min-w-0 flex-1 hover:text-primary transition-colors"
                    >
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
                    </Link>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                  {/* Heal action */}
                  <div className="flex gap-1.5 mt-2">
                    <Button
                      size="sm" variant="outline"
                      className="h-6 text-[10px] px-2 gap-1"
                      disabled={busy}
                      onClick={(e) => { e.preventDefault(); integrityMutation.mutate(a.package_id); }}
                    >
                      {integrityMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Integrity neu prüfen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
