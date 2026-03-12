import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAdminDashboard } from '@/components/admin/hooks/useAdminDashboard';
import {
  AlertTriangle, DollarSign, Layers,
  RefreshCw, Radio, Wrench, Zap
} from 'lucide-react';

export default function GlobalStatusBar() {
  const { data, isLoading, refetch } = useAdminDashboard();

  if (isLoading || !data) return null;

  const k = data.kpis;
  const bm = k.building_metrics;

  // Traffic light from health items
  const hasRed = data.health.some(h => h.tone === 'red');
  const hasYellow = data.health.some(h => h.tone === 'yellow');
  const light = hasRed ? 'red' : hasYellow ? 'yellow' : 'green';
  const lightColor = light === 'red' ? 'bg-destructive' : light === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500';
  const lightPulse = light !== 'green' ? 'animate-pulse' : '';

  return (
    <div className="h-10 bg-card/90 backdrop-blur-md border-b border-border/60 flex items-center gap-3 px-4 text-xs overflow-x-auto shrink-0 shadow-sm">
      {/* Traffic Light */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={cn("w-2.5 h-2.5 rounded-full", lightColor, lightPulse)} />
        <span className="font-semibold text-foreground">SSOT</span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Pipeline */}
      <div className="flex items-center gap-1 shrink-0">
        <Radio className="h-3 w-3 text-primary" />
        <span className="text-muted-foreground">
          {bm.active_by_leases > 0 ? (
            <span className="text-primary font-medium">{bm.active_by_jobs} Jobs aktiv</span>
          ) : (
            'Idle'
          )}
        </span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Queue */}
      <div className="flex items-center gap-1 shrink-0">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">{k.queued}q</span>
        <span className="text-primary">{k.building}b</span>
        {k.failed > 0 && (
          <span className="text-destructive">{k.failed}f</span>
        )}
        <span className="text-emerald-500">{k.done}✓</span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Failures 24h */}
      {k.jobs_failed_24h > 0 && (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            <span className="text-destructive">{k.jobs_failed_24h}/24h</span>
          </div>
          <div className="w-px h-5 bg-border shrink-0" />
        </>
      )}

      {/* Stalled */}
      {k.stalled_packages > 0 && (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span className="text-yellow-600">{k.stalled_packages} stalled</span>
          </div>
          <div className="w-px h-5 bg-border shrink-0" />
        </>
      )}

      {/* Cost */}
      <div className="flex items-center gap-1 shrink-0">
        <DollarSign className="h-3 w-3 text-muted-foreground" />
        <span className={cn("text-muted-foreground", k.cost_today_eur > 15 && "text-destructive")}>
          €{k.cost_today_eur.toFixed(2)}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh */}
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => refetch()}>
        <RefreshCw className="h-3 w-3" />
      </Button>
    </div>
  );
}
