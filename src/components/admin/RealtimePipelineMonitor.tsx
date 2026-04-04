import { useRealtimePipeline } from '@/hooks/useAdminRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, CheckCircle2, Clock, Loader2, Radio, RefreshCw,
  XCircle, AlertTriangle, HeartPulse, Timer, ChevronDown, ChevronRight,
  Shield, Wrench, Zap
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState } from 'react';
import { CompetencyBundleProgress } from './CompetencyBundleProgress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  FULL_STEP_ORDER,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_EMOJI,
} from '@/lib/pipeline-steps';

// Derived from SSOT
const STEP_META: Record<string, { label: string; emoji: string }> = Object.fromEntries(
  FULL_STEP_ORDER.map(k => [k, { label: PIPELINE_STEP_LABELS[k], emoji: PIPELINE_STEP_EMOJI[k] }])
);
const STEP_ORDER = FULL_STEP_ORDER as readonly string[];

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'running': case 'enqueued': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
    case 'timeout': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'skipped': return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
    case 'blocked': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function HeartbeatAge({ ts }: { ts: string | null }) {
  if (!ts) return null;
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageSec = Math.round(ageMs / 1000);
  const stale = ageSec > 120;
  return (
    <span className={cn("text-[10px] flex items-center gap-0.5", stale ? "text-destructive" : "text-muted-foreground")}>
      <HeartPulse className="h-2.5 w-2.5" />
      {ageSec}s
    </span>
  );
}

const GATE_CLASS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof Shield }> = {
  healthy: { label: 'Healthy', variant: 'default', icon: CheckCircle2 },
  soft_pass_with_debt: { label: 'Soft Pass', variant: 'secondary', icon: AlertTriangle },
  repair_required: { label: 'Repair', variant: 'outline', icon: Wrench },
  major_regeneration_required: { label: 'Major Regen', variant: 'destructive', icon: Zap },
  hard_fail: { label: 'Hard Fail', variant: 'destructive', icon: XCircle },
};

function GateClassDetail({ step }: { step: any }) {
  const meta = step.meta as Record<string, unknown> | null;
  const gateClass = meta?.gate_class as string | undefined;
  if (!gateClass) return null;

  const config = GATE_CLASS_CONFIG[gateClass] || { label: gateClass, variant: 'outline' as const, icon: Shield };
  const GateIcon = config.icon;
  const tier1Rate = meta?.tier1_pass_rate != null ? (Number(meta.tier1_pass_rate) * 100).toFixed(0) : null;
  const reasonCode = meta?.reason_code as string | undefined;
  const repairAction = meta?.repair_action as string | undefined;
  const capabilities = meta?.capabilities as Record<string, boolean> | undefined;
  const failureModes = meta?.top_failure_modes as Array<{ code: string; count: number }> | undefined;
  const affectedCount = meta?.affected_lessons_count as number | undefined;

  const capLabels: Record<string, string> = {
    allowsBlueprintSeeding: 'Blueprints',
    allowsExamPoolGeneration: 'Exam-Pool',
    allowsMiniCheckGeneration: 'MiniChecks',
    allowsHandbookGeneration: 'Handbook',
    allowsTutorIndexing: 'Tutor-Index',
  };

  return (
    <div className="ml-7 mt-0.5 mb-1 px-2 py-1.5 rounded bg-muted/50 border border-border/40 space-y-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <GateIcon className="h-3 w-3" />
        <Badge variant={config.variant} className="text-[9px]">{config.label}</Badge>
        {tier1Rate && <span className="text-[10px] text-muted-foreground">T1: {tier1Rate}%</span>}
        {reasonCode && <span className="text-[10px] text-muted-foreground font-mono">{reasonCode}</span>}
        {repairAction && repairAction !== 'none' && (
          <Badge variant="outline" className="text-[9px]">
            <Wrench className="h-2.5 w-2.5 mr-0.5" />
            {repairAction === 'enqueue_targeted_repair' ? 'Targeted' : repairAction === 'enqueue_major_regeneration' ? 'Major' : repairAction}
          </Badge>
        )}
        {affectedCount != null && affectedCount > 0 && (
          <span className="text-[10px] text-muted-foreground">{affectedCount} betroffen</span>
        )}
      </div>

      {capabilities && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] text-muted-foreground">Caps:</span>
          {Object.entries(capabilities).map(([key, allowed]) => (
            <span
              key={key}
              className={cn(
                "text-[9px] px-1 py-0.5 rounded",
                allowed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"
              )}
            >
              {capLabels[key] || key}
            </span>
          ))}
        </div>
      )}

      {failureModes && failureModes.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[9px] text-muted-foreground">Fehler:</span>
          {failureModes.slice(0, 5).map(fm => (
            <span key={fm.code} className="text-[9px] font-mono text-muted-foreground">
              {fm.code}×{fm.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


  const [expanded, setExpanded] = useState(true);
  const pkgSteps = steps.filter(s => s.package_id === pkg.id);
  const sortedSteps = STEP_ORDER.map(key => pkgSteps.find(s => s.step_key === key)).filter(Boolean);
  const currentStep = sortedSteps.find(s => s!.status === 'running' || s!.status === 'enqueued');
  const doneCount = sortedSteps.filter(s => s!.status === 'done' || s!.status === 'skipped').length;
  const progress = Math.round((doneCount / STEP_ORDER.length) * 100);
  const currentLabel = currentStep
    ? STEP_META[currentStep.step_key]?.label || currentStep.step_key
    : doneCount === STEP_ORDER.length ? 'Fertig' : 'Wartend';

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{pkg.title || pkg.id.slice(0, 8)}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{currentLabel}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">{progress}%</Badge>
      </button>

      {/* Compact progress bar */}
      <div className="w-full bg-muted h-1">
        <div className="bg-primary h-1 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {expanded && (
        <div className="px-3 py-2 space-y-0.5">
          {sortedSteps.map((step) => {
            if (!step) return null;
            const meta = STEP_META[step.step_key] || { label: step.step_key, emoji: '⚙️' };
            const isRunning = step.status === 'running' || step.status === 'enqueued';
            const isFailed = step.status === 'failed' || step.status === 'timeout';

            return (
              <div key={step.step_key}>
                <div
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors",
                    isRunning && "bg-primary/5 border border-primary/20",
                    isFailed && "bg-destructive/5",
                  )}
                >
                  <span className="text-sm">{meta.emoji}</span>
                  <StepStatusIcon status={step.status} />
                  <span className={cn("flex-1 truncate", isRunning && "font-medium text-primary")}>
                    {meta.label}
                  </span>

                  {(isRunning || isFailed) && (() => {
                    const m = step.meta as Record<string, unknown> | null;
                    const remaining = m?.remaining != null ? Number(m.remaining) : null;
                    const generated = m?.generated != null ? Number(m.generated) : null;
                    if (remaining !== null && generated !== null) {
                      return (
                        <span className="text-[10px] text-muted-foreground">
                          {generated}/{generated + remaining}
                        </span>
                      );
                    }
                    return (
                      <span className="text-[10px] text-muted-foreground">
                        #{step.attempts}
                      </span>
                    );
                  })()}

                  {isRunning && <HeartbeatAge ts={step.last_heartbeat_at} />}

                  {step.status === 'done' && step.started_at && step.finished_at && (
                    <span className="text-[10px] text-muted-foreground">
                      <Timer className="h-2.5 w-2.5 inline mr-0.5" />
                      {Math.round((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s
                    </span>
                  )}

                  {isFailed && step.last_error && (
                    <span className="text-[10px] text-destructive max-w-[180px] truncate">
                      {step.last_error}
                    </span>
                  )}

                  <Badge
                    variant={step.status === 'done' ? 'default' : isRunning ? 'secondary' : isFailed ? 'destructive' : 'outline'}
                    className="text-[9px] shrink-0"
                  >
                    {step.status}
                  </Badge>
                </div>
                {step.step_key === 'generate_learning_content' && (isRunning || isFailed) && (
                  <CompetencyBundleProgress packageId={pkg.id} />
                )}
                {step.step_key === 'validate_learning_content' && <GateClassDetail step={step} />}
              </div>
            );
          })}

          {currentStep && (
            <div className="mt-1.5 pt-1.5 border-t border-border/50 flex items-center gap-2 text-[10px] text-muted-foreground">
              <Radio className="h-3 w-3 text-primary animate-pulse" />
              Runner: {currentStep.runner_id || '–'}
              {currentStep.started_at && (
                <> · {formatDistanceToNow(new Date(currentStep.started_at), { locale: de, addSuffix: true })}</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RealtimePipelineMonitor() {
  const { steps, allPackages, loading, refetch } = useRealtimePipeline();

  if (loading) return <Skeleton className="h-64" />;

  if (!allPackages.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Radio className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Kein aktives Build — Pipeline idle</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
            <RefreshCw className="h-3 w-3 mr-1" /> Prüfen
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Active Pipelines ({allPackages.length})
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refetch}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {allPackages.map((pkg: any) => (
          <PackagePipeline key={pkg.id} pkg={pkg} steps={steps} />
        ))}
      </CardContent>
    </Card>
  );
}
