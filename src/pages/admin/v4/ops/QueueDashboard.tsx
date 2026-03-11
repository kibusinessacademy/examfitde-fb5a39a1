import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loading } from './OpsShared';
import { AlertTriangle, Ban, Clock, Info } from 'lucide-react';

interface RollupRow {
  hour_bucket: string;
  job_type: string;
  total: number;
  completed: number;
  failed: number;
  gen0_failed: number;
  cancelled: number;
  blocked: number;
  pending: number;
  processing: number;
  exhausted: number;
  avg_fail_attempts: number | null;
}

function StatusCard({ label, value, color, subtitle }: { label: string; value: number; color: string; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-xl font-bold mt-1", color)}>{value}</p>
        {subtitle && <p className="text-[9px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function JobBadge({ status, meta, lastError }: { status: string; meta: any; lastError?: string }) {
  const outcome = meta?.outcome;
  const isBlocked = status === 'cancelled' && outcome === 'blocked';
  const isGen0 = lastError?.includes('gen=0');
  const reason = meta?.soft_stopped_reason || meta?.softStoppedReason || meta?.reason;
  const attempted = meta?.attempted;
  const consecutiveTransient = meta?.consecutive_transient;

  let badgeClass = '';
  let label = status;

  if (isBlocked) {
    badgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    label = 'blocked';
  } else if (status === 'cancelled') {
    badgeClass = 'bg-muted text-muted-foreground';
  } else if (status === 'failed') {
    badgeClass = isGen0
      ? 'bg-orange-500/10 text-orange-600 border-orange-500/20'
      : 'bg-destructive/10 text-destructive border-destructive/20';
    label = isGen0 ? 'gen=0' : 'failed';
  } else if (status === 'completed') {
    badgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  } else if (status === 'processing') {
    badgeClass = 'bg-primary/10 text-primary border-primary/20';
  } else {
    badgeClass = '';
  }

  const hasTooltip = reason || attempted || isBlocked || isGen0;

  const badge = (
    <Badge variant="outline" className={cn("text-[10px] gap-1", badgeClass)}>
      {isBlocked && <Ban className="h-2.5 w-2.5" />}
      {isGen0 && <AlertTriangle className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  );

  if (!hasTooltip) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs space-y-1">
          {reason && <p><span className="font-medium">Reason:</span> {reason}</p>}
          {attempted != null && <p><span className="font-medium">Attempted:</span> {attempted}</p>}
          {consecutiveTransient != null && <p><span className="font-medium">Transient streak:</span> {consecutiveTransient}</p>}
          {isBlocked && <p className="text-amber-600">Job blocked — wird später erneut geprüft</p>}
          {isGen0 && <p className="text-orange-600">LLM lieferte leeres Ergebnis (gen=0)</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function QueueDashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [rollup, setRollup] = useState<RollupRow[]>([]);
  const [pkgNames, setPkgNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [jobsRes, rollupRes] = await Promise.all([
      (supabase as any).from('job_queue')
        .select('*').order('created_at', { ascending: false }).limit(100),
      (supabase as any).from('ops_job_queue_rollup')
        .select('*').limit(50),
    ]);
    const jobData = jobsRes.data || [];
    setJobs(jobData);
    setRollup(rollupRes.data || []);

    // Resolve package_id → course title
    const pkgIds = [...new Set(jobData.map((j: any) => j.package_id || j.payload?.package_id).filter(Boolean))] as string[];
    if (pkgIds.length > 0) {
      const { data: pkgs } = await (supabase as any)
        .from('course_packages')
        .select('id, courses(title)')
        .in('id', pkgIds);
      const map: Record<string, string> = {};
      for (const p of (pkgs || [])) {
        map[p.id] = p.courses?.title || p.id.substring(0, 8);
      }
      setPkgNames(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);
  if (loading) return <Loading />;

  const statusCounts = jobs.reduce((acc: any, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});
  const gen0Count = jobs.filter(j => j.status === 'failed' && (j.last_error?.includes('gen=0') || j.error?.includes('gen=0'))).length;
  const blockedCount = jobs.filter(j => j.status === 'cancelled' && j.meta?.outcome === 'blocked').length;
  const exhaustedCount = jobs.filter(j => j.status === 'failed' && j.attempts >= j.max_attempts).length;

  return (
    <div className="space-y-4">
      {/* Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatusCard label="Pending" value={statusCounts['pending'] || 0} color="text-muted-foreground" />
        <StatusCard label="Processing" value={statusCounts['processing'] || 0} color="text-primary" />
        <StatusCard label="Completed" value={statusCounts['completed'] || 0} color="text-emerald-500" />
        <StatusCard label="Failed" value={statusCounts['failed'] || 0} color="text-destructive"
          subtitle={gen0Count ? `${gen0Count} gen=0` : undefined} />
        <StatusCard label="Blocked" value={blockedCount} color="text-amber-500"
          subtitle={blockedCount ? 'cancelled+blocked' : undefined} />
        <StatusCard label="Gen=0" value={gen0Count} color="text-orange-500"
          subtitle="LLM empty result" />
        <StatusCard label="Exhausted" value={exhaustedCount} color="text-destructive"
          subtitle="max attempts" />
      </div>

      {/* Hourly Rollup */}
      {rollup.length > 0 && (
        <div className="overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Stündlicher Rollup (48h)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 px-2">Stunde</th>
                <th className="text-left py-1.5 px-2">Typ</th>
                <th className="text-right py-1.5 px-2">✅</th>
                <th className="text-right py-1.5 px-2">❌</th>
                <th className="text-right py-1.5 px-2">gen=0</th>
                <th className="text-right py-1.5 px-2">🚫</th>
                <th className="text-right py-1.5 px-2">⏳</th>
                <th className="text-right py-1.5 px-2">Ø Att</th>
              </tr>
            </thead>
            <tbody>
              {rollup.slice(0, 24).map((r, i) => {
                const gen0Pct = r.failed > 0 ? Math.round(100 * r.gen0_failed / r.failed) : 0;
                return (
                  <tr key={i} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="py-1.5 px-2 text-muted-foreground font-mono">
                      {new Date(r.hour_bucket).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                    <td className="py-1.5 px-2 font-mono truncate max-w-[140px]">{r.job_type.replace('package_', '')}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-500 font-medium">{r.completed}</td>
                    <td className="py-1.5 px-2 text-right text-destructive font-medium">{r.failed}</td>
                    <td className="py-1.5 px-2 text-right">
                      <span className={cn("font-medium", gen0Pct > 50 ? "text-orange-500" : "text-muted-foreground")}>
                        {r.gen0_failed}{gen0Pct > 0 && <span className="text-[9px] ml-0.5">({gen0Pct}%)</span>}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-amber-500">{r.blocked}</td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{r.pending + r.processing}</td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{r.avg_fail_attempts ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Job Table */}
      <div className="overflow-x-auto">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
          <Info className="h-3 w-3" /> Letzte 50 Jobs
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 px-3">Job Type</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Attempts</th>
              <th className="text-left py-2 px-3">Package</th>
              <th className="text-left py-2 px-3">Fehler</th>
              <th className="text-left py-2 px-3">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 50).map(j => (
              <tr key={j.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-2 px-3 font-mono">{j.job_type}</td>
                <td className="py-2 px-3">
                  <JobBadge status={j.status} meta={j.meta} lastError={j.last_error || j.error} />
                </td>
                <td className="py-2 px-3">{j.attempts}/{j.max_attempts}</td>
                <td className="py-2 px-3 font-mono text-muted-foreground truncate max-w-[120px]">
                  {j.payload?.package_id?.substring(0, 8) || j.package_id?.substring(0, 8) || '–'}
                </td>
                <td className={cn(
                  "py-2 px-3 truncate max-w-[200px]",
                  j.status === 'completed' ? 'text-muted-foreground/50 line-through' : 'text-destructive'
                )}>
                  {j.status === 'completed' && j.last_error
                    ? <span className="text-muted-foreground/40 text-[10px]">(historisch) {j.last_error}</span>
                    : (j.last_error || j.error || '–')
                  }
                </td>
                <td className="py-2 px-3 text-muted-foreground">
                  {new Date(j.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
