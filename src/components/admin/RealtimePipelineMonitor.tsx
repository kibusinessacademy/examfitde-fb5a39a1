import { useRealtimePipeline } from '@/hooks/useAdminRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, CheckCircle2, Clock, Loader2, Radio, RefreshCw,
  XCircle, AlertTriangle, HeartPulse, Timer, ChevronDown, ChevronRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState } from 'react';
import { CompetencyBundleProgress } from './CompetencyBundleProgress';

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

function PackagePipeline({ pkg, steps }: { pkg: any; steps: any[] }) {
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
