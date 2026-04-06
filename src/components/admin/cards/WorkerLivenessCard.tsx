import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Server, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LivenessRow {
  package_id: string;
  title: string;
  status: string;
  fresh_active_jobs: number;
  zombie_jobs: number;
  running_steps: number;
  has_lease: boolean;
  liveness_verdict: 'alive' | 'false_active' | 'no_activity';
  last_pipeline_event_at: string | null;
}

export default function WorkerLivenessCard() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin', 'worker-liveness'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ops_build_activity_truth')
        .select('package_id, title, status, fresh_active_jobs, zombie_jobs, running_steps, has_lease, liveness_verdict, last_pipeline_event_at')
        .limit(100);
      if (error) return [];
      return (data ?? []) as LivenessRow[];
    },
    refetchInterval: 30_000,
  });

  const alive = rows.filter(r => r.liveness_verdict === 'alive').length;
  const falseActive = rows.filter(r => r.liveness_verdict === 'false_active').length;
  const noActivity = rows.filter(r => r.liveness_verdict === 'no_activity').length;
  const hasProblem = falseActive > 0 || noActivity > 0;

  if (isLoading || rows.length === 0) return null;

  return (
    <Card className={cn(
      hasProblem ? 'border-warning/40 bg-warning/5' : 'border-success/30 bg-success/5'
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className={cn('h-4 w-4', hasProblem ? 'text-warning' : 'text-success')} />
          Worker Liveness
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-xs">
              {alive} alive
            </Badge>
            {falseActive > 0 && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                {falseActive} ghost
              </Badge>
            )}
            {noActivity > 0 && (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
                {noActivity} idle
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      {hasProblem && (
        <CardContent className="space-y-1 max-h-40 overflow-y-auto">
          {rows.filter(r => r.liveness_verdict !== 'alive').map(r => (
            <div key={r.package_id} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1.5">
              {r.liveness_verdict === 'false_active' ? (
                <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
              ) : (
                <Activity className="h-3 w-3 text-warning shrink-0" />
              )}
              <span className="truncate font-medium">{(r.title || r.package_id.slice(0, 8)).replace(/^ExamFit\s*–\s*/i, '')}</span>
              <Badge variant="outline" className="text-[9px] ml-auto shrink-0">
                {r.liveness_verdict === 'false_active' ? 'Ghost' : 'Idle'}
              </Badge>
              <span className="text-muted-foreground shrink-0">
                {r.zombie_jobs > 0 ? `${r.zombie_jobs} zombies` : `${r.fresh_active_jobs} jobs`}
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
