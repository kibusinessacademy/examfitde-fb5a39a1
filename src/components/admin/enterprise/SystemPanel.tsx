import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Cpu, AlertTriangle, CheckCircle2, Clock, Zap, Server, XCircle } from 'lucide-react';
import { useSystemHealth } from '@/hooks/useAdminAudit';
import { useAdminQueueSSOT } from '@/hooks/useAdminQueueSSOT';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';

function HealthIndicator({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        <Badge variant={ok ? 'outline' : 'destructive'} className="text-[10px]">
          {ok ? 'OK' : 'Problem'}
        </Badge>
      </div>
    </div>
  );
}

export default function SystemPanel() {
  const { data: health, isLoading: healthLoading } = useSystemHealth();
  const { data: jobs, isLoading: jobsLoading } = useAdminQueueSSOT();

  const jobStats = useMemo(() => {
    if (!jobs) return null;
    const processing = jobs.filter(j => ['processing', 'running', 'batch_pending'].includes(j.job_status));
    const failed = jobs.filter(j => j.job_status === 'failed');
    const zombies = jobs.filter(j => j.health_signal === 'zombie');
    const stale = jobs.filter(j => j.health_signal === 'stale');

    // Job type distribution
    const byType = new Map<string, number>();
    processing.forEach(j => byType.set(j.job_type, (byType.get(j.job_type) || 0) + 1));
    const topTypes = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    return { processing: processing.length, failed: failed.length, zombies: zombies.length, stale: stale.length, topTypes };
  }, [jobs]);

  const isLoading = healthLoading || jobsLoading;

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {health && (
        <CommandKpiStrip>
          <KpiCard label="Queue Pending" value={health.queue_pending} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
          <KpiCard label="Processing" value={health.queue_processing} icon={<Zap className="h-4 w-4 text-primary" />} tone={health.queue_processing > 0 ? 'green' : 'neutral'} />
          <KpiCard label="Failed" value={health.queue_failed} icon={<XCircle className="h-4 w-4 text-destructive" />} tone={health.queue_failed > 0 ? 'red' : 'neutral'} />
          <KpiCard label="Aktive Leases" value={health.active_leases} icon={<Server className="h-4 w-4 text-primary" />} />
        </CommandKpiStrip>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> System Health</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthIndicator label="Job Queue" ok={(health?.queue_failed ?? 0) === 0} detail={`${health?.queue_failed || 0} fehlgeschlagen`} />
          <HealthIndicator label="Zombies" ok={(jobStats?.zombies ?? 0) === 0} detail={`${jobStats?.zombies || 0} Zombie-Jobs`} />
          <HealthIndicator label="Stale Jobs" ok={(jobStats?.stale ?? 0) < 5} detail={`${jobStats?.stale || 0} veraltete Jobs`} />
          <HealthIndicator label="Lease Pressure" ok={(health?.active_leases ?? 0) < 50} detail={`${health?.active_leases || 0} aktiv`} />
        </CardContent>
      </Card>

      {jobStats?.topTypes && jobStats.topTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Aktive Job-Typen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {jobStats.topTypes.map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-xs font-mono truncate max-w-[250px]">{type}</span>
                  <Badge variant="outline" className="text-[10px]">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {jobStats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Anomalien</CardTitle>
          </CardHeader>
          <CardContent>
            {jobStats.failed === 0 && jobStats.zombies === 0 && jobStats.stale === 0 ? (
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm">Keine Anomalien erkannt</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {jobStats.failed > 0 && (
                  <div className="flex items-center gap-2 text-destructive text-xs">
                    <XCircle className="h-3.5 w-3.5" /> {jobStats.failed} fehlgeschlagene Jobs
                  </div>
                )}
                {jobStats.zombies > 0 && (
                  <div className="flex items-center gap-2 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" /> {jobStats.zombies} Zombie-Jobs erkannt
                  </div>
                )}
                {jobStats.stale > 0 && (
                  <div className="flex items-center gap-2 text-warning text-xs">
                    <Clock className="h-3.5 w-3.5" /> {jobStats.stale} veraltete Jobs
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
