import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Play, AlertTriangle } from 'lucide-react';

interface BuildStep {
  id: string;
  step_key: string;
  step_label: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  retry_count: number;
  log: Record<string, unknown> | null;
  sort_order: number;
}

interface PackageInfo {
  id: string;
  title: string;
  status: string;
  build_progress: number;
  integrity_passed: boolean;
  updated_at: string;
}

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: '📚 Lernkurs scaffolden',
  generate_exam_pool: '📝 Prüfungsfragen generieren',
  generate_oral_exam: '🎤 Mündliche Prüfung',
  build_ai_tutor_index: '🤖 AI Tutor Index',
  generate_handbook: '📖 Handbuch erstellen',
  run_integrity_check: '🔍 Integritätsprüfung',
  auto_publish: '🚀 Veröffentlichung',
};

const STEP_ORDER = [
  'scaffold_learning_course',
  'generate_exam_pool',
  'generate_oral_exam',
  'build_ai_tutor_index',
  'generate_handbook',
  'run_integrity_check',
  'auto_publish',
];

function statusIcon(status: string) {
  switch (status) {
    case 'done': return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case 'running': return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    case 'failed': return <XCircle className="h-5 w-5 text-destructive" />;
    case 'pending': return <Clock className="h-5 w-5 text-muted-foreground" />;
    default: return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 animate-pulse',
    failed: 'bg-destructive/15 text-destructive border-destructive/30',
    pending: 'bg-muted text-muted-foreground border-border',
  };
  const labels: Record<string, string> = {
    done: 'Fertig', running: 'Läuft…', failed: 'Fehler', pending: 'Wartend',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[status] || variants.pending}`}>
      {labels[status] || status}
    </span>
  );
}

function formatDuration(ms: number | null) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const PACKAGE_ID = 'a1000001-0001-4000-8000-000000000001';

export default function PipelineMonitorPage() {
  const [steps, setSteps] = useState<BuildStep[]>([]);
  const [pkg, setPkg] = useState<PackageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    const [stepsRes, pkgRes] = await Promise.all([
      supabase
        .from('course_package_build_steps')
        .select('*')
        .eq('package_id', PACKAGE_ID),
      supabase
        .from('course_packages')
        .select('id, title, status, build_progress, integrity_passed, updated_at')
        .eq('id', PACKAGE_ID)
        .single(),
    ]);

    if (stepsRes.data) {
      const sorted = (stepsRes.data as BuildStep[]).sort((a, b) => {
        const ai = STEP_ORDER.indexOf(a.step_key);
        const bi = STEP_ORDER.indexOf(b.step_key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      setSteps(sorted);
    }
    if (pkgRes.data) setPkg(pkgRes.data as PackageInfo);
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const doneCount = steps.filter(s => s.status === 'done').length;
  const totalCount = steps.length || 7;
  const runningStep = steps.find(s => s.status === 'running');
  const failedSteps = steps.filter(s => s.status === 'failed');
  const isComplete = doneCount === totalCount && totalCount > 0;
  const hasErrors = failedSteps.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pkg?.title || 'Automobilkaufmann'} — Live-Überwachung der Build-Pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Auto 3s</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1.5" /> Auto aus</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Fortschritt</div>
            <div className="text-2xl font-bold">{pkg?.build_progress ?? 0}%</div>
            <Progress value={pkg?.build_progress ?? 0} className="mt-2 h-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Steps</div>
            <div className="text-2xl font-bold">{doneCount}/{totalCount}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {isComplete ? '✅ Alle fertig' : runningStep ? `⏳ ${STEP_LABELS[runningStep.step_key] || runningStep.step_key}` : hasErrors ? '❌ Fehler aufgetreten' : '⏸ Wartend'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Paket-Status</div>
            <div className="text-2xl font-bold capitalize">{pkg?.status || '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Letztes Update</div>
            <div className="text-lg font-mono">{lastRefresh.toLocaleTimeString('de-DE')}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {autoRefresh && <span className="text-emerald-500">● Live</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Steps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Build-Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1">
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-colors ${
                    step.status === 'running' ? 'bg-blue-500/5 border border-blue-500/20' :
                    step.status === 'failed' ? 'bg-destructive/5 border border-destructive/20' :
                    step.status === 'done' ? 'bg-emerald-500/5' :
                    'bg-muted/30'
                  }`}
                >
                  {/* Step number + icon */}
                  <div className="flex items-center gap-3 w-8">
                    <span className="text-xs font-mono text-muted-foreground w-4">{idx + 1}</span>
                    {statusIcon(step.status)}
                  </div>

                  {/* Step name */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {STEP_LABELS[step.step_key] || step.step_key}
                    </div>
                    {step.error_message && (
                      <div className="text-xs text-destructive mt-0.5 truncate flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {step.error_message}
                      </div>
                    )}
                    {step.log && step.status === 'done' && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {Object.entries(step.log as Record<string, unknown>)
                          .filter(([k]) => k !== 'ok' && k !== 'note')
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </div>
                    )}
                    {step.log && step.status === 'running' && (step.log as Record<string, string>).note && (
                      <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                        {(step.log as Record<string, string>).note}
                      </div>
                    )}
                  </div>

                  {/* Timing */}
                  <div className="text-right shrink-0 space-y-0.5">
                    {statusBadge(step.status)}
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {step.status === 'done' ? formatDuration(step.duration_ms) :
                       step.status === 'running' ? `seit ${formatTime(step.started_at)}` : ''}
                    </div>
                  </div>

                  {/* Connector line */}
                  {idx < steps.length - 1 && (
                    <div className="absolute left-[2.65rem] h-1 w-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Detail */}
      {steps.some(s => s.log && Object.keys(s.log as Record<string, unknown>).length > 2) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Step Details (JSON)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs overflow-x-auto max-h-80 overflow-y-auto space-y-3">
              {steps.filter(s => s.status !== 'pending').map(s => (
                <div key={s.id}>
                  <div className="text-muted-foreground mb-1">{STEP_LABELS[s.step_key] || s.step_key} ({s.status})</div>
                  <pre className="text-foreground whitespace-pre-wrap">{JSON.stringify(s.log, null, 2)}</pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}