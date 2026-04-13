import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Activity, Heart, Skull, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunnerHealth {
  runner_name: string;
  worker_id: string;
  lanes: string[];
  health_status: string;
  seconds_ago: number;
  passes: number;
  claimed: number;
  succeeded: number;
  failed: number;
  runtime_ms: number;
  error_message: string | null;
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default function RunnerHealthCard() {
  const { data: runners, isLoading } = useQuery({
    queryKey: ['runner-health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_runner_health_latest')
        .select('*');
      if (error) throw error;
      return (data ?? []) as RunnerHealth[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-24 mb-2" />
        <div className="h-8 bg-muted rounded" />
      </div>
    );
  }

  const hasIssues = runners?.some(r => r.health_status !== 'alive');

  return (
    <div className={cn(
      "rounded-lg border p-3",
      hasIssues ? "border-destructive/50 bg-destructive/5" : "border-border bg-card"
    )}>
      <div className="flex items-center gap-1.5 mb-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Runner Health</span>
      </div>
      
      {(!runners || runners.length === 0) ? (
        <p className="text-[10px] text-muted-foreground">Keine Heartbeats empfangen. Runner wurden noch nicht ausgeführt.</p>
      ) : (
        <div className="space-y-1.5">
          {runners.map((r) => (
            <div key={r.runner_name} className="flex items-center gap-2">
              {r.health_status === 'alive' ? (
                <Heart className="h-3 w-3 text-success fill-success" />
              ) : r.health_status === 'dead' || r.health_status === 'crash' ? (
                <Skull className="h-3 w-3 text-destructive" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-warning" />
              )}
              <span className="text-xs font-medium text-foreground flex-1 truncate">
                {r.runner_name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {r.lanes?.join(', ')}
              </span>
              <span className={cn(
                "text-[10px] font-mono",
                r.health_status === 'alive' ? "text-success" : 
                r.health_status === 'stale' ? "text-warning" : "text-destructive"
              )}>
                {formatAgo(r.seconds_ago)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                ✓{r.succeeded} ✗{r.failed}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
