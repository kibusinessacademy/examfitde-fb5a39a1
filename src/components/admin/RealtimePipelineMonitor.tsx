import { useRealtimePipeline } from '@/hooks/useAdminRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, CheckCircle2, Clock, Loader2, Radio, RefreshCw,
  XCircle, AlertTriangle, HeartPulse, Timer
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

const STEP_META: Record<string, { label: string; emoji: string }> = {
  scaffold_learning_course: { label: 'Lernkurs erstellen', emoji: '📚' },
  generate_learning_content: { label: 'Lerninhalte generieren', emoji: '✏️' },
  validate_learning_content: { label: 'Lerninhalte validieren', emoji: '✅' },
  auto_seed_exam_blueprints: { label: 'Blueprints seeden', emoji: '🗺️' },
  generate_exam_pool: { label: 'Prüfungsfragen', emoji: '❓' },
  validate_exam_pool: { label: 'Prüfungen validieren', emoji: '✅' },
  generate_oral_exam: { label: 'Mündliche Prüfung', emoji: '🎤' },
  validate_oral_exam: { label: 'Mündliche validieren', emoji: '✅' },
  build_ai_tutor_index: { label: 'KI-Tutor Index', emoji: '🤖' },
  generate_handbook: { label: 'Handbuch', emoji: '📖' },
  validate_handbook: { label: 'Handbuch validieren', emoji: '✅' },
  run_integrity_check: { label: 'Integritätsprüfung', emoji: '🔍' },
  quality_council: { label: 'Quality Council', emoji: '🛡️' },
  auto_publish: { label: 'Veröffentlichen', emoji: '🚀' },
};

const STEP_ORDER = [
  'scaffold_learning_course', 'generate_learning_content', 'validate_learning_content',
  'auto_seed_exam_blueprints', 'generate_exam_pool', 'validate_exam_pool',
  'generate_oral_exam', 'validate_oral_exam', 'build_ai_tutor_index',
  'generate_handbook', 'validate_handbook', 'run_integrity_check',
  'quality_council', 'auto_publish',
];

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
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

export default function RealtimePipelineMonitor() {
  const { steps, activePackage, loading, refetch } = useRealtimePipeline();

  if (loading) return <Skeleton className="h-64" />;

  if (!activePackage) {
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

  const sortedSteps = STEP_ORDER.map(key => steps.find(s => s.step_key === key)).filter(Boolean);
  const currentStep = sortedSteps.find(s => s!.status === 'running');
  const doneCount = sortedSteps.filter(s => s!.status === 'done' || s!.status === 'skipped').length;
  const progress = Math.round((doneCount / STEP_ORDER.length) * 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Pipeline — {activePackage.title || activePackage.id.slice(0, 8)}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{progress}%</Badge>
            <Badge variant="secondary" className="text-[10px]">{activePackage.pipeline_mode || 'factory'}</Badge>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refetch}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 mb-4">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-1">
          {sortedSteps.map((step) => {
            if (!step) return null;
            const meta = STEP_META[step.step_key] || { label: step.step_key, emoji: '⚙️' };
            const isRunning = step.status === 'running';
            const isFailed = step.status === 'failed' || step.status === 'timeout';

            return (
              <div
                key={step.step_key}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isRunning && "bg-primary/5 border border-primary/20",
                  isFailed && "bg-destructive/5",
                )}
              >
                <span className="text-base">{meta.emoji}</span>
                <StepStatusIcon status={step.status} />
                <span className={cn("flex-1", isRunning && "font-medium text-primary")}>
                  {meta.label}
                </span>

                {/* Attempt counter */}
                <span className="text-[10px] text-muted-foreground">
                  {step.attempts}/{step.max_attempts}
                </span>

                {/* Heartbeat age (only for running) */}
                {isRunning && <HeartbeatAge ts={step.last_heartbeat_at} />}

                {/* Duration for done */}
                {step.status === 'done' && step.started_at && step.finished_at && (
                  <span className="text-[10px] text-muted-foreground">
                    <Timer className="h-2.5 w-2.5 inline mr-0.5" />
                    {Math.round((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s
                  </span>
                )}

                {/* Error snippet */}
                {isFailed && step.last_error && (
                  <span className="text-[10px] text-destructive max-w-[200px] truncate">
                    {step.last_error}
                  </span>
                )}

                <Badge
                  variant={step.status === 'done' ? 'default' : step.status === 'running' ? 'secondary' : isFailed ? 'destructive' : 'outline'}
                  className="text-[9px] shrink-0"
                >
                  {step.status}
                </Badge>
              </div>
            );
          })}
        </div>

        {/* Runner info */}
        {currentStep && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Radio className="h-3 w-3 text-primary animate-pulse" />
            Runner: {currentStep.runner_id || '–'}
            {currentStep.started_at && (
              <> · gestartet {formatDistanceToNow(new Date(currentStep.started_at), { locale: de, addSuffix: true })}</>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
