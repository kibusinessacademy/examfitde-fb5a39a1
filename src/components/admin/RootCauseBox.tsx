import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOpsDiagnosis, useHealAction, type RootCause } from '@/hooks/useOpsHealth';
import { AlertTriangle, Wrench, Eye, Zap, ShieldOff, Loader2, Lock, Timer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';

const RISK_COLORS = {
  low: 'bg-emerald-500/10 text-emerald-600',
  medium: 'bg-yellow-500/10 text-yellow-600',
  high: 'bg-destructive/10 text-destructive',
};

const SEVERITY_COLORS = {
  critical: 'border-l-destructive bg-destructive/5',
  warning: 'border-l-yellow-500 bg-yellow-500/5',
  info: 'border-l-muted bg-muted/5',
};

const SEVERITY_LABELS: Record<string, { label: string; emoji: string }> = {
  critical: { label: 'Critical', emoji: '🔴' },
  warning: { label: 'Warning', emoji: '🟡' },
  info: { label: 'Info', emoji: '🔵' },
};

export default function RootCauseBox() {
  const { data: diagnosis, isLoading } = useOpsDiagnosis();
  const healAction = useHealAction();

  if (isLoading) return <Skeleton className="h-40" />;
  if (!diagnosis || diagnosis.root_causes.length === 0) return null;

  const handleHealSingle = (rc: RootCause) => {
    healAction.mutate({
      mode: 'heal_single',
      action_type: rc.action_type,
      package_id: rc.params?.package_id as string,
      params: rc.params,
    });
  };

  const handleHealAll = () => {
    healAction.mutate({ mode: 'heal' });
  };

  const autoHealable = diagnosis.root_causes.filter(rc => rc.auto_healable);
  const isIncident = diagnosis.incident_mode;

  // Group by severity
  const critical = diagnosis.root_causes.filter(rc => rc.severity === 'critical');
  const warnings = diagnosis.root_causes.filter(rc => rc.severity === 'warning');
  const infos = diagnosis.root_causes.filter(rc => rc.severity === 'info');

  const renderCause = (rc: RootCause, i: number) => {
    const sev = SEVERITY_LABELS[rc.severity] || SEVERITY_LABELS.info;
    const cooldown = diagnosis.cooldown_status?.[rc.action_type];
    const isCooled = cooldown?.cooling;

    return (
      <div
        key={`${rc.code}-${i}`}
        className={cn("rounded-lg border-l-4 p-3", SEVERITY_COLORS[rc.severity])}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs">{sev.emoji}</span>
              <p className="text-sm font-semibold text-foreground">{rc.title}</p>
              <Badge variant="outline" className={cn("text-[10px]", RISK_COLORS[rc.risk])}>
                Risiko: {rc.risk}
              </Badge>
              {rc.auto_healable && !isCooled && (
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">
                  🤖 Auto-Heal
                </Badge>
              )}
              {isCooled && (
                <Badge variant="outline" className="text-[10px] gap-1 bg-muted/50">
                  <Timer className="h-2.5 w-2.5" />
                  Cooldown bis {cooldown.resumesAt ? new Date(cooldown.resumesAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '?'}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{rc.description}</p>
            <p className="text-xs text-foreground mt-1.5 font-medium">
              ➡️ {rc.recommended_action}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            {rc.auto_healable && !isIncident && !isCooled && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleHealSingle(rc)}
                disabled={healAction.isPending}
              >
                <Wrench className="h-3 w-3 mr-1" /> Fix
              </Button>
            )}
            {isIncident && rc.auto_healable && (
              <Badge variant="destructive" className="text-[9px] gap-1 h-7 flex items-center">
                <Lock className="h-2.5 w-2.5" /> Gesperrt
              </Badge>
            )}
            {rc.params?.package_id && (
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link to={`/admin/studio/${rc.params.package_id}`}>
                  <Eye className="h-3 w-3 mr-1" /> Details
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Root Causes ({diagnosis.root_causes.length})
            {critical.length > 0 && (
              <Badge variant="destructive" className="text-[9px]">
                {critical.length} Critical
              </Badge>
            )}
          </CardTitle>
          {autoHealable.length > 0 && (
            <Button
              size="sm"
              variant="default"
              onClick={handleHealAll}
              disabled={healAction.isPending || !diagnosis.auto_heal_allowed || isIncident}
              className="h-7 text-xs"
            >
              {healAction.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : isIncident ? (
                <Lock className="h-3 w-3 mr-1" />
              ) : (
                <Zap className="h-3 w-3 mr-1" />
              )}
              {isIncident ? 'Incident aktiv' : `Alle auto-reparieren (${autoHealable.length})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Critical first, then warning, then info */}
        {critical.map((rc, i) => renderCause(rc, i))}
        {warnings.map((rc, i) => renderCause(rc, i + 100))}
        {infos.map((rc, i) => renderCause(rc, i + 200))}

        {!diagnosis.auto_heal_allowed && autoHealable.length > 0 && !isIncident && (
          <div className="flex items-center gap-2 p-2 rounded bg-destructive/5 text-xs text-destructive">
            <ShieldOff className="h-3.5 w-3.5 shrink-0" />
            Auto-Heal deaktiviert: Zu viele Stuck Jobs, Failures oder Budget überschritten.
          </div>
        )}

        {isIncident && (
          <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-xs text-destructive font-medium">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            🚨 Incident Mode aktiv – Alle automatischen Aktionen gestoppt. Nur manuelle Eingriffe möglich.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
