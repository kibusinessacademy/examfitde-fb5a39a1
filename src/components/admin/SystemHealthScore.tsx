import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOpsHealthSummary } from '@/hooks/useOpsHealth';
import { HeartPulse, Shield, Zap, Activity, DollarSign, Wrench, Snowflake, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function SystemHealthScore() {
  const { data: health, isLoading, refetch } = useOpsHealthSummary();

  if (isLoading) return <Skeleton className="h-28" />;
  if (!health) return null;

  const score = health.health_score;
  const light = health.traffic_light;

  const lightConfig = {
    green: { color: 'bg-emerald-500', label: 'GESUND', emoji: '🟢', border: 'border-l-emerald-500', bg: 'bg-emerald-500/5' },
    yellow: { color: 'bg-yellow-500', label: 'DEGRADED', emoji: '🟡', border: 'border-l-yellow-500', bg: 'bg-yellow-500/5' },
    red: { color: 'bg-destructive', label: 'INCIDENT', emoji: '🔴', border: 'border-l-destructive', bg: 'bg-destructive/5' },
  }[light];

  const badges: Array<{ label: string; icon: React.ElementType; active: boolean; variant: 'default' | 'destructive' | 'secondary' }> = [
    { label: 'Auto-Heal aktiv', icon: Wrench, active: health.auto_heal_allowed, variant: health.auto_heal_allowed ? 'default' : 'secondary' },
    { label: `Budget €${health.daily_autofix_cost.toFixed(0)}/€15`, icon: DollarSign, active: health.daily_autofix_cost < 15, variant: health.daily_autofix_cost >= 12 ? 'destructive' : 'default' },
    { label: `${health.frozen_autofix} Frozen`, icon: Snowflake, active: health.frozen_autofix > 0, variant: health.frozen_autofix > 0 ? 'destructive' : 'secondary' },
  ];

  return (
    <Card className={cn("border-l-4", lightConfig.border, lightConfig.bg)}>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className={cn("w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg", lightConfig.color)}>
              {score}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">{lightConfig.label}</h2>
                <span className="text-lg">{lightConfig.emoji}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {health.failed_1h} Failed/1h · {health.stuck_jobs} Stuck · {health.active_builds} Builds · {health.live_packages} Live
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {badges.map(b => {
              const Icon = b.icon;
              return (
                <Badge key={b.label} variant={b.variant} className="text-[10px] gap-1">
                  <Icon className="h-3 w-3" /> {b.label}
                </Badge>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
