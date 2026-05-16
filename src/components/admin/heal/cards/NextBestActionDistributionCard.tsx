import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = {
  nba_action: string;
  retention_risk: string;
  learner_count: number;
  avg_priority: number;
  avg_failure_risk: number;
  avg_exam_success_prob: number;
  pending_dispatch_count: number;
};

const RISK_TONE: Record<string, string> = {
  critical: 'bg-destructive-bg-subtle text-destructive border-destructive-border',
  high: 'bg-warning-bg-subtle text-warning border-warning-border',
  medium: 'bg-muted text-text-secondary border-border',
  low: 'bg-success-bg-subtle text-success border-success-border',
};

export function NextBestActionDistributionCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-intervention-distribution'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('admin_get_intervention_distribution' as any);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const totalLearners = (data ?? []).reduce((s, r) => s + Number(r.learner_count ?? 0), 0);
  const pendingDispatch = (data ?? []).reduce((s, r) => s + Number(r.pending_dispatch_count ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Intervention Intelligence — Next Best Action
        </CardTitle>
        <div className="text-xs text-text-secondary flex gap-3 mt-1">
          <span>{totalLearners} learners</span>
          <span>•</span>
          <span className={pendingDispatch > 0 ? 'text-warning' : ''}>
            {pendingDispatch} pending high-priority dispatch
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          </div>
        ) : !data?.length ? (
          <div className="text-sm text-text-secondary text-center py-6">
            No intervention states yet — waiting for readiness signals.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {data.map((row, i) => (
              <div
                key={`${row.nba_action}-${row.retention_risk}-${i}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-surface-subtle"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant="outline" className="font-mono text-xs">
                    {row.nba_action}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn('text-xs border', RISK_TONE[row.retention_risk] ?? '')}
                  >
                    {row.retention_risk}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-secondary flex-shrink-0">
                  <span className="font-semibold text-text-primary">{row.learner_count}</span>
                  <span>p={row.avg_priority}</span>
                  <span>risk={row.avg_failure_risk}%</span>
                  <span>P(pass)={row.avg_exam_success_prob}%</span>
                  {row.pending_dispatch_count > 0 && (
                    <Badge variant="outline" className="text-xs border-warning-border text-warning">
                      {row.pending_dispatch_count} pending
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
