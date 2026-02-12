import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOpsHealthSummary, useOpsDiagnosis, useHealAction } from '@/hooks/useOpsHealth';
import { DollarSign, Wrench, Snowflake, RefreshCw, AlertOctagon, Loader2, Timer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function SystemHealthScore() {
  const { data: health, isLoading, refetch } = useOpsHealthSummary();
  const { data: diagnosis } = useOpsDiagnosis();
  const healAction = useHealAction();

  if (isLoading) return <Skeleton className="h-28" />;
  if (!health) return null;

  const score = health.health_score;
  const light = health.traffic_light;
  const isIncident = diagnosis?.incident_mode ?? false;

  const lightConfig = isIncident
    ? { color: 'bg-destructive', label: 'INCIDENT MODE', emoji: '🚨', border: 'border-l-destructive', bg: 'bg-destructive/5' }
    : {
        green: { color: 'bg-emerald-500', label: 'GESUND', emoji: '🟢', border: 'border-l-emerald-500', bg: 'bg-emerald-500/5' },
        yellow: { color: 'bg-yellow-500', label: 'DEGRADED', emoji: '🟡', border: 'border-l-yellow-500', bg: 'bg-yellow-500/5' },
        red: { color: 'bg-destructive', label: 'INCIDENT', emoji: '🔴', border: 'border-l-destructive', bg: 'bg-destructive/5' },
      }[light];

  const toggleIncident = () => {
    healAction.mutate({ mode: isIncident ? 'incident_off' : 'incident_on' });
  };

  // Cooldown badges
  const cooldowns = diagnosis?.cooldown_status || {};
  const activeCooldowns = Object.entries(cooldowns).filter(([, v]) => v.cooling);

  const badges: Array<{ label: string; icon: React.ElementType; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = [
    {
      label: health.auto_heal_allowed && !isIncident ? 'Auto-Heal aktiv' : 'Auto-Heal gestoppt',
      icon: Wrench,
      variant: health.auto_heal_allowed && !isIncident ? 'default' : 'destructive',
    },
    {
      label: `Budget €${health.daily_autofix_cost.toFixed(0)}/€15`,
      icon: DollarSign,
      variant: health.daily_autofix_cost >= 12 ? 'destructive' : 'default',
    },
  ];

  if (health.frozen_autofix > 0) {
    badges.push({ label: `${health.frozen_autofix} Frozen`, icon: Snowflake, variant: 'destructive' });
  }

  if (activeCooldowns.length > 0) {
    badges.push({
      label: `${activeCooldowns.length} Cooldown${activeCooldowns.length > 1 ? 's' : ''}`,
      icon: Timer,
      variant: 'outline',
    });
  }

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
              {isIncident && diagnosis?.incident_activated_at && (
                <p className="text-[10px] text-destructive mt-0.5">
                  Incident seit {new Date(diagnosis.incident_activated_at).toLocaleString('de-DE')}
                </p>
              )}
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

            <Button
              variant={isIncident ? 'destructive' : 'outline'}
              size="sm"
              onClick={toggleIncident}
              disabled={healAction.isPending}
              className="h-7 text-[10px] gap-1"
            >
              {healAction.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <AlertOctagon className="h-3 w-3" />
              )}
              {isIncident ? 'Incident beenden' : 'Incident Mode'}
            </Button>

            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Active cooldowns detail */}
        {activeCooldowns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
            {activeCooldowns.map(([action, cd]) => (
              <Badge key={action} variant="outline" className="text-[9px] gap-1 bg-muted/30">
                <Timer className="h-2.5 w-2.5" />
                {action.replace(/_/g, ' ')} → {cd.resumesAt ? new Date(cd.resumesAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '?'}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
