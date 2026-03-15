import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Activity, CheckCircle2, Clock, Loader2, XCircle, RefreshCw, Timer, Gauge } from 'lucide-react';
import { Loading } from './OpsShared';

interface BenchmarkPackage {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  curriculum_id: string | null;
}

interface StepState {
  step_key: string;
  status: string;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
}

interface BenchmarkMetrics {
  blueprints: number;
  questions: number;
  totalRuntime: number | null; // seconds from first step start
  stepsCompleted: number;
  stepsTotal: number;
  currentStep: string | null;
  retryCount: number;
}

const STEP_LABELS: Record<string, string> = {
  auto_seed_exam_blueprints: '🗺️ Blueprint Seeding',
  validate_blueprints: '✅ Blueprint Validation',
  generate_exam_pool: '❓ Exam Pool',
  validate_exam_pool: '✅ Exam Validation',
  generate_oral_exam: '🎤 Oral Exam',
  validate_oral_exam: '✅ Oral Validation',
  build_ai_tutor_index: '🤖 Tutor Index',
  validate_tutor_index: '✅ Tutor Validation',
  run_integrity_check: '🔍 Integrity',
  quality_council: '🛡️ Council',
  auto_publish: '🚀 Publish',
};

const STEP_ORDER = Object.keys(STEP_LABELS);

export default function BenchmarkMonitor() {
  const [packages, setPackages] = useState<BenchmarkPackage[]>([]);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [metrics, setMetrics] = useState<BenchmarkMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Load actively building packages via SSOT view
    const { data: pkgs } = await (supabase as any)
      .from('v_admin_visible_course_packages')
      .select('id, canonical_title, title, status, priority, created_at, updated_at, curriculum_id')
      .in('status', ['building', 'queued', 'failed'])
      .order('priority', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(10);

    const list = pkgs || [];
    setPackages(list);

    const pkgId = selectedPkg || list[0]?.id;
    if (!pkgId) { setLoading(false); return; }
    if (!selectedPkg && list[0]) setSelectedPkg(list[0].id);

    // Load steps for selected package
    const { data: stepData } = await (supabase as any)
      .from('package_steps')
      .select('step_key, status, attempts, started_at, finished_at, last_heartbeat_at')
      .eq('package_id', pkgId)
      .order('created_at');

    const stepsArr: StepState[] = stepData || [];
    setSteps(stepsArr);

    // Load metrics – package-scoped via curriculum_id from view
    const pkg = list.find((p: any) => p.id === pkgId);

    let blueprints = 0, questions = 0;
    if (pkg?.curriculum_id) {
      const [bpRes, qRes] = await Promise.all([
        (supabase as any).from('question_blueprints').select('id', { count: 'exact', head: true }).eq('curriculum_id', pkg.curriculum_id),
        (supabase as any).from('exam_questions').select('id', { count: 'exact', head: true }).eq('curriculum_id', pkg.curriculum_id),
      ]);
      blueprints = bpRes.count || 0;
      questions = qRes.count || 0;
    }

    const sorted = STEP_ORDER.map(k => stepsArr.find(s => s.step_key === k)).filter(Boolean) as StepState[];
    const completed = sorted.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const current = sorted.find(s => s.status === 'running' || s.status === 'enqueued' || s.status === 'processing');
    const retries = sorted.reduce((sum, s) => sum + Math.max(0, s.attempts - 1), 0);

    const firstStart = sorted.filter(s => s.started_at).map(s => new Date(s.started_at!).getTime()).sort()[0];
    const lastFinish = sorted.filter(s => s.finished_at).map(s => new Date(s.finished_at!).getTime()).sort().reverse()[0];
    const runtime = firstStart ? Math.round(((lastFinish || Date.now()) - firstStart) / 1000) : null;

    setMetrics({
      blueprints,
      questions,
      totalRuntime: runtime,
      stepsCompleted: completed,
      stepsTotal: STEP_ORDER.length,
      currentStep: current?.step_key || null,
      retryCount: retries,
    });

    setLoading(false);
  }, [selectedPkg]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return <Loading />;
  if (!packages.length) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center">
        <Gauge className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Keine aktiven Builds</p>
      </CardContent>
    </Card>
  );

  const progress = metrics ? Math.round((metrics.stepsCompleted / metrics.stepsTotal) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Benchmark Monitor
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={load}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        {packages.length > 1 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {packages.map(p => (
              <Badge
                key={p.id}
                variant={p.id === selectedPkg ? 'default' : 'outline'}
                className="cursor-pointer text-[10px]"
                onClick={() => setSelectedPkg(p.id)}
              >
                {p.title?.slice(0, 25) || p.id.slice(0, 8)}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Row */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <KPICard label="Blueprints" value={metrics.blueprints} target="~150" />
            <KPICard label="Fragen" value={metrics.questions} target="≥850" />
            <KPICard label="Fortschritt" value={`${progress}%`} sub={`${metrics.stepsCompleted}/${metrics.stepsTotal}`} />
            <KPICard label="Laufzeit" value={formatDuration(metrics.totalRuntime)} />
            <KPICard label="Retries" value={metrics.retryCount} alert={metrics.retryCount > 3} />
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step timeline */}
        <div className="space-y-1">
          {STEP_ORDER.map(key => {
            const step = steps.find(s => s.step_key === key);
            const status = step?.status || 'pending';
            const isActive = status === 'running' || status === 'enqueued' || status === 'processing';
            const isDone = status === 'done' || status === 'skipped';
            const isFailed = status === 'failed' || status === 'timeout';
            const duration = step?.started_at && step?.finished_at
              ? Math.round((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000)
              : null;

            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors",
                  isActive && "bg-primary/5 border border-primary/20",
                  isFailed && "bg-destructive/5",
                )}
              >
                {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                {isActive && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
                {isFailed && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                {!isDone && !isActive && !isFailed && <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

                <span className={cn("flex-1", isActive && "font-medium text-primary")}>
                  {STEP_LABELS[key] || key}
                </span>

                {step && step.attempts > 0 && (
                  <span className="text-[10px] text-muted-foreground">#{step.attempts}</span>
                )}

                {duration !== null && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Timer className="h-2.5 w-2.5" /> {duration}s
                  </span>
                )}

                <Badge
                  variant={isDone ? 'default' : isActive ? 'secondary' : isFailed ? 'destructive' : 'outline'}
                  className="text-[9px] shrink-0"
                >
                  {status}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function KPICard({ label, value, target, sub, alert }: {
  label: string; value: string | number; target?: string; sub?: string; alert?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-2.5", alert && "border-destructive/50 bg-destructive/5")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold mt-0.5", alert && "text-destructive")}>{value}</p>
      {target && <p className="text-[10px] text-muted-foreground">Ziel: {target}</p>}
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '–';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
