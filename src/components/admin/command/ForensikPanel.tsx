import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ShieldAlert, Lock, Clock, Unplug, AlertTriangle } from 'lucide-react';

interface MissingJobRow {
  package_id: string;
  title: string;
  step_key: string;
  step_status: string;
  step_updated_at: string;
}

interface BatchStuckRow {
  job_type: string;
  batch_cursor: unknown;
  requeues_last_2h: number;
}

function useForensikData() {
  return useQuery({
    queryKey: ['forensik-panel'],
    queryFn: async () => {
      const sb = supabase as any;
      const [unlockedRes, staleRes, batchRes, missingRes] = await Promise.all([
        sb.from('ops_processing_unlocked').select('processing_unlocked').single(),
        sb.from('ops_processing_stale').select('processing_stale').single(),
        sb.from('ops_batch_cursor_stuck').select('*'),
        sb.from('ops_queued_steps_missing_job').select('*'),
      ]);
      return {
        unlocked: (unlockedRes.data?.processing_unlocked ?? 0) as number,
        stale: (staleRes.data?.processing_stale ?? 0) as number,
        batchStuck: (batchRes.data ?? []) as BatchStuckRow[],
        missingJobs: (missingRes.data ?? []) as MissingJobRow[],
      };
    },
    refetchInterval: 30_000,
  });
}

function Stat({ icon, label, value, alert }: {
  icon: React.ReactNode; label: string; value: number; alert?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3",
      alert ? 'border-destructive/40 bg-destructive/5' : 'border-border',
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-xl font-bold font-mono", alert && 'text-destructive')}>{value}</p>
    </div>
  );
}

export default function ForensikPanel() {
  const { data, isLoading } = useForensikData();

  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;

  const hasIssues = data.unlocked > 0 || data.stale > 0 || data.batchStuck.length > 0 || data.missingJobs.length > 0;

  return (
    <Card className={cn(hasIssues && 'border-destructive/30')}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Forensik (Live)
          {!hasIssues && <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50">Sauber</Badge>}
          {hasIssues && <Badge variant="destructive" className="text-[10px]">Aktion nötig</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat
            icon={<Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Processing unlocked"
            value={data.unlocked}
            alert={data.unlocked > 0}
          />
          <Stat
            icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Processing stale"
            value={data.stale}
            alert={data.stale > 0}
          />
          <Stat
            icon={<AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Batch-Cursor stuck"
            value={data.batchStuck.length}
            alert={data.batchStuck.length > 0}
          />
          <Stat
            icon={<Unplug className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Queued ohne Job"
            value={data.missingJobs.length}
            alert={data.missingJobs.length > 0}
          />
        </div>

        {/* Detail rows for missing jobs */}
        {data.missingJobs.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Verwaiste Steps</p>
            {data.missingJobs.map((m) => (
              <div key={`${m.package_id}-${m.step_key}`} className="flex items-center justify-between text-xs border-b border-border/50 py-1">
                <span className="truncate max-w-[200px] font-medium">{m.title}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{m.step_key}</Badge>
                  <Badge variant="destructive" className="text-[10px]">{m.step_status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail rows for batch stuck */}
        {data.batchStuck.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Batch-Loops</p>
            {data.batchStuck.map((b, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b border-border/50 py-1">
                <span className="font-medium">{b.job_type}</span>
                <Badge variant="destructive" className="text-[10px]">{b.requeues_last_2h}× in 2h</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
