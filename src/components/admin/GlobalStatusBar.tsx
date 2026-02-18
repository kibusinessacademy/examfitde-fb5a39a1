import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdminKPIs } from '@/hooks/useAdminRealtime';
import {
  Activity, AlertTriangle, DollarSign, Gauge, Layers,
  RefreshCw, Loader2, Radio, Wrench, Zap
} from 'lucide-react';

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Scaffold',
  auto_seed_exam_blueprints: 'Blueprints',
  generate_exam_pool: 'Prüfungen',
  generate_oral_exam: 'Mündlich',
  build_ai_tutor_index: 'Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA Council',
  auto_publish: 'Publish',
};

export default function GlobalStatusBar() {
  const { kpis, loading, refetch } = useAdminKPIs();

  if (loading) return null;

  const light = kpis.traffic_light;
  const lightColor = light === 'red' ? 'bg-destructive' : light === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500';
  const lightPulse = light !== 'green' ? 'animate-pulse' : '';

  return (
    <div className="h-10 bg-card/80 backdrop-blur-sm border-b border-border flex items-center gap-3 px-4 text-xs overflow-x-auto shrink-0">
      {/* Traffic Light */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={cn("w-2.5 h-2.5 rounded-full", lightColor, lightPulse)} />
        <span className="font-semibold text-foreground">{kpis.health_score}</span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Pipeline */}
      <div className="flex items-center gap-1 shrink-0">
        <Radio className="h-3 w-3 text-primary" />
        <span className="text-muted-foreground">
          {kpis.active_leases > 0 ? (
            <span className="text-primary font-medium">{kpis.running_steps} Step aktiv</span>
          ) : (
            'Idle'
          )}
        </span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Queue */}
      <div className="flex items-center gap-1 shrink-0">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">{kpis.queued_packages}q</span>
        <span className="text-primary">{kpis.building_packages}b</span>
        {kpis.blocked_packages > 0 && (
          <span className="text-yellow-600">{kpis.blocked_packages}🚫</span>
        )}
        {kpis.failed_packages > 0 && (
          <span className="text-destructive">{kpis.failed_packages}f</span>
        )}
        <span className="text-emerald-500">{kpis.done_packages}✓</span>
      </div>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* Failures */}
      {kpis.failed_1h > 0 && (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            <span className="text-destructive">{kpis.failed_1h}/1h</span>
          </div>
          <div className="w-px h-5 bg-border shrink-0" />
        </>
      )}

      {/* Stuck */}
      {kpis.stuck_jobs > 0 && (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span className="text-yellow-600">{kpis.stuck_jobs} stuck</span>
          </div>
          <div className="w-px h-5 bg-border shrink-0" />
        </>
      )}

      {/* Cost */}
      <div className="flex items-center gap-1 shrink-0">
        <DollarSign className="h-3 w-3 text-muted-foreground" />
        <span className={cn("text-muted-foreground", kpis.daily_cost > 12 && "text-destructive")}>
          €{kpis.daily_cost.toFixed(0)}/15
        </span>
      </div>

      {/* Auto-Heal */}
      <div className="flex items-center gap-1 shrink-0">
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className={cn(kpis.auto_heal_allowed ? "text-emerald-500" : "text-destructive")}>
          {kpis.auto_heal_allowed ? 'on' : 'off'}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh */}
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={refetch}>
        <RefreshCw className="h-3 w-3" />
      </Button>
    </div>
  );
}
