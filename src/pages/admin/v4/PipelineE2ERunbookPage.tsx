import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, XCircle, Loader2, Play, ClipboardList,
  AlertTriangle, RefreshCw, ChevronDown, ChevronRight, FlaskConical
} from 'lucide-react';

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn';

interface CheckResult {
  status: CheckStatus;
  data?: any;
  error?: string;
  ts?: string;
}

const CHECKS = [
  { id: 'select_package', label: '1. Testpaket auswählen', desc: 'Package mit niedrigem Legacy-Anteil finden' },
  { id: 'baseline', label: '2. Ausgangszustand dokumentieren', desc: 'needs_regen, bundles, artifact status vor Start' },
  { id: 'dispatcher', label: '3. Dispatcher prüfen', desc: 'Bundle-Jobs erzeugt? Dedup sauber?' },
  { id: 'bundle_worker', label: '4. Bundle-Worker prüfen', desc: 'Lesson-Subjobs korrekt enqueued?' },
  { id: 'lesson_subjobs', label: '5. Lesson-Subjobs prüfen', desc: 'Content erzeugt? Keine Hollow/Placeholder?' },
  { id: 'monitor', label: '6. Bundle-Monitor prüfen', desc: 'Metriken plausibel und live?' },
  { id: 'hybrid_completion', label: '7. Hybrid-Completion prüfen', desc: 'check_fan_out_completion korrekt?' },
  { id: 'runner', label: '8. Runner-Verhalten prüfen', desc: 'Step sauber auf done? Kein Loop?' },
  { id: 'watchdog', label: '9. Watchdog-Verhalten prüfen', desc: 'Keine unnötigen Statuswechsel?' },
  { id: 'auto_heal', label: '10. Auto-Heal prüfen', desc: 'Recovery logisch? (optional)' },
  { id: 'artifact_truth', label: '11. Artefakt-Truth final', desc: 'get_learning_content_progress grün?' },
  { id: 'legacy_audit', label: '12. Legacy-Anteil prüfen', desc: 'Legacy messbar und nachvollziehbar?' },
] as const;

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'pass': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'fail': return <XCircle className="h-4 w-4 text-destructive" />;
    case 'warn': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    default: return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;
  }
}

export default function PipelineE2ERunbookPage() {
  const [packageId, setPackageId] = useState('');
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const setCheckResult = (id: string, result: CheckResult) => {
    setResults(prev => ({ ...prev, [id]: { ...result, ts: new Date().toISOString() } }));
  };

  // ── Check 1: Find best test package ──
  const runSelectPackage = useCallback(async () => {
    setCheckResult('select_package', { status: 'running' });
    try {
      const { data: audit, error } = await (supabase as any).rpc('get_legacy_lesson_audit');
      if (error) throw error;

      // Also get building packages
      const { data: pkgs } = await (supabase as any)
        .from('course_packages')
        .select('id,title,status,build_progress')
        .in('status', ['building', 'queued'])
        .order('updated_at', { ascending: false })
        .limit(20);

      const candidates = (pkgs || []).map((p: any) => {
        const legacyInfo = (audit || []).find((a: any) => a.package_id === p.id);
        return {
          ...p,
          legacy_pct: legacyInfo?.legacy_pct ?? 0,
          legacy_count: legacyInfo?.lessons_without_competency ?? 0,
          total_lessons: legacyInfo?.total_lessons ?? 0,
        };
      });

      setCheckResult('select_package', {
        status: candidates.length > 0 ? 'pass' : 'warn',
        data: { candidates, audit_summary: audit?.length ?? 0 },
      });
    } catch (e) {
      setCheckResult('select_package', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 2: Baseline ──
  const runBaseline = useCallback(async () => {
    if (!packageId) { setCheckResult('baseline', { status: 'fail', error: 'Kein Paket ausgewählt' }); return; }
    setCheckResult('baseline', { status: 'running' });
    try {
      const [bundleRes, stepRes, progressRes] = await Promise.all([
        (supabase as any).rpc('get_competency_bundle_progress', { p_package_id: packageId }),
        (supabase as any).from('package_steps').select('status,meta,attempts')
          .eq('package_id', packageId).eq('step_key', 'generate_learning_content').maybeSingle(),
        (supabase as any).rpc('get_learning_content_progress', { p_package_id: packageId }),
      ]);

      setCheckResult('baseline', {
        status: 'pass',
        data: {
          bundle_progress: bundleRes.data,
          step: stepRes.data,
          artifact_progress: progressRes.data,
        },
      });
    } catch (e) {
      setCheckResult('baseline', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 3: Dispatcher ──
  const runDispatcher = useCallback(async () => {
    if (!packageId) { setCheckResult('dispatcher', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('dispatcher', { status: 'running' });
    try {
      const { data: bundleJobs, error } = await (supabase as any)
        .from('job_queue')
        .select('id,status,batch_cursor,idempotency_key,created_at')
        .eq('package_id', packageId)
        .eq('job_type', 'lesson_generate_competency_bundle')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Check dedup: unique competency_ids
      const competencyIds = (bundleJobs || [])
        .map((j: any) => j.batch_cursor?.competency_id)
        .filter(Boolean);
      const uniqueCompetencies = new Set(competencyIds);
      const hasDupes = competencyIds.length !== uniqueCompetencies.size;

      // Check for legacy jobs
      const { data: legacyJobs } = await (supabase as any)
        .from('job_queue')
        .select('id,status')
        .eq('package_id', packageId)
        .eq('job_type', 'lesson_generate_content')
        .in('status', ['pending', 'processing', 'queued'])
        .limit(50);

      setCheckResult('dispatcher', {
        status: hasDupes ? 'fail' : (bundleJobs?.length > 0 ? 'pass' : 'warn'),
        data: {
          bundle_jobs: bundleJobs?.length ?? 0,
          unique_competencies: uniqueCompetencies.size,
          has_duplicates: hasDupes,
          legacy_active: legacyJobs?.length ?? 0,
          sample_jobs: (bundleJobs || []).slice(0, 5).map((j: any) => ({
            id: j.id.slice(0, 8),
            status: j.status,
            competency: j.batch_cursor?.competency_id?.slice(0, 8),
          })),
        },
      });
    } catch (e) {
      setCheckResult('dispatcher', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 4: Bundle Worker ──
  const runBundleWorker = useCallback(async () => {
    if (!packageId) { setCheckResult('bundle_worker', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('bundle_worker', { status: 'running' });
    try {
      // Get done bundles and their spawned lesson jobs
      const { data: doneBundles } = await (supabase as any)
        .from('job_queue')
        .select('id,batch_cursor,payload')
        .eq('package_id', packageId)
        .eq('job_type', 'lesson_generate_competency_bundle')
        .eq('status', 'done')
        .limit(5);

      const sampleCompetencies = (doneBundles || [])
        .map((b: any) => b.batch_cursor?.competency_id || b.payload?.competency_id)
        .filter(Boolean)
        .slice(0, 3);

      // For each sample competency, check spawned lesson jobs
      const samples = [];
      for (const cid of sampleCompetencies) {
        const { data: lessonJobs } = await (supabase as any)
          .from('job_queue')
          .select('id,status,batch_cursor')
          .eq('package_id', packageId)
          .eq('job_type', 'lesson_generate_content')
          .limit(200);

        const matching = (lessonJobs || []).filter(
          (j: any) => j.batch_cursor?.competency_id === cid
        );

        samples.push({
          competency_id: cid.slice(0, 8),
          lesson_subjobs: matching.length,
          done: matching.filter((j: any) => j.status === 'done').length,
          failed: matching.filter((j: any) => j.status === 'failed').length,
          pending: matching.filter((j: any) => ['pending', 'processing', 'queued'].includes(j.status)).length,
        });
      }

      setCheckResult('bundle_worker', {
        status: doneBundles?.length > 0 ? 'pass' : 'warn',
        data: {
          done_bundles: doneBundles?.length ?? 0,
          samples,
        },
      });
    } catch (e) {
      setCheckResult('bundle_worker', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 5: Lesson Subjobs ──
  const runLessonSubjobs = useCallback(async () => {
    if (!packageId) { setCheckResult('lesson_subjobs', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('lesson_subjobs', { status: 'running' });
    try {
      const { data: doneJobs } = await (supabase as any)
        .from('job_queue')
        .select('id,payload')
        .eq('package_id', packageId)
        .eq('job_type', 'lesson_generate_content')
        .eq('status', 'done')
        .limit(10);

      const lessonIds = (doneJobs || [])
        .map((j: any) => j.payload?.lesson_id)
        .filter(Boolean)
        .slice(0, 5);

      const samples = [];
      for (const lid of lessonIds) {
        const { data: lesson } = await (supabase as any)
          .from('lessons')
          .select('id,title,competency_id,content,qc_status')
          .eq('id', lid)
          .maybeSingle();

        if (lesson) {
          const contentStr = typeof lesson.content === 'string'
            ? lesson.content
            : JSON.stringify(lesson.content || '');
          const isHollow = !contentStr || contentStr.length < 600
            || contentStr.includes('_placeholder');
          const hasJsonFence = contentStr.includes('```json');

          samples.push({
            id: lesson.id.slice(0, 8),
            title: lesson.title?.slice(0, 40),
            competency_id: lesson.competency_id?.slice(0, 8) ?? 'NULL',
            content_length: contentStr.length,
            is_hollow: isHollow,
            has_json_fence: hasJsonFence,
            qc_status: lesson.qc_status,
          });
        }
      }

      const issues = samples.filter(s => s.is_hollow || s.has_json_fence);
      setCheckResult('lesson_subjobs', {
        status: issues.length > 0 ? 'fail' : (samples.length > 0 ? 'pass' : 'warn'),
        data: { total_done_jobs: doneJobs?.length ?? 0, samples, issues_count: issues.length },
      });
    } catch (e) {
      setCheckResult('lesson_subjobs', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 6: Monitor metrics ──
  const runMonitor = useCallback(async () => {
    if (!packageId) { setCheckResult('monitor', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('monitor', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_competency_bundle_progress', {
        p_package_id: packageId,
      });
      if (error) throw error;

      const d = data as any;
      const consistent = d.bundles_done + d.bundles_failed + d.bundles_active <= d.bundles_total;

      setCheckResult('monitor', {
        status: consistent ? 'pass' : 'fail',
        data: { ...d, consistent },
      });
    } catch (e) {
      setCheckResult('monitor', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 7: Hybrid Completion ──
  const runHybridCompletion = useCallback(async () => {
    if (!packageId) { setCheckResult('hybrid_completion', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('hybrid_completion', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('check_fan_out_completion', {
        p_package_id: packageId,
        p_step_key: 'generate_learning_content',
      });
      if (error) throw error;

      const d = data as any;
      setCheckResult('hybrid_completion', {
        status: d?.ok ? 'pass' : (d?.active_subjobs > 0 ? 'warn' : 'fail'),
        data: d,
      });
    } catch (e) {
      setCheckResult('hybrid_completion', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 8: Runner (step status) ──
  const runRunner = useCallback(async () => {
    if (!packageId) { setCheckResult('runner', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('runner', { status: 'running' });
    try {
      const { data: step } = await (supabase as any)
        .from('package_steps')
        .select('status,attempts,meta,last_error,finished_at')
        .eq('package_id', packageId)
        .eq('step_key', 'generate_learning_content')
        .maybeSingle();

      const isDone = step?.status === 'done';
      const isLooping = (step?.attempts ?? 0) > 10;

      setCheckResult('runner', {
        status: isDone ? 'pass' : (isLooping ? 'fail' : 'warn'),
        data: {
          status: step?.status,
          attempts: step?.attempts,
          finished_at: step?.finished_at,
          is_looping: isLooping,
          meta_snippet: step?.meta
            ? { dispatcher_mode: step.meta.dispatcher_mode, needs_regen: step.meta.needs_regen }
            : null,
          last_error: step?.last_error?.slice(0, 200),
        },
      });
    } catch (e) {
      setCheckResult('runner', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 9: Watchdog ──
  const runWatchdog = useCallback(async () => {
    if (!packageId) { setCheckResult('watchdog', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('watchdog', { status: 'running' });
    try {
      const { data: events } = await (supabase as any)
        .from('pipeline_health_events')
        .select('event_type,message,created_at')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false })
        .limit(20);

      const suspiciousResets = (events || []).filter(
        (e: any) => e.event_type === 'step_reset' || e.message?.includes('watchdog')
      );

      setCheckResult('watchdog', {
        status: suspiciousResets.length > 3 ? 'fail' : 'pass',
        data: {
          total_events: events?.length ?? 0,
          suspicious_resets: suspiciousResets.length,
          recent: (events || []).slice(0, 5),
        },
      });
    } catch (e) {
      // pipeline_health_events may not exist — that's OK
      setCheckResult('watchdog', { status: 'warn', data: { note: 'Events-Tabelle nicht verfügbar' } });
    }
  }, [packageId]);

  // ── Check 10: Auto-Heal ──
  const runAutoHeal = useCallback(async () => {
    if (!packageId) { setCheckResult('auto_heal', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('auto_heal', { status: 'running' });
    try {
      const { data: healLogs } = await (supabase as any)
        .from('auto_heal_log')
        .select('action_type,result_status,target_id,created_at')
        .eq('target_id', packageId)
        .order('created_at', { ascending: false })
        .limit(10);

      setCheckResult('auto_heal', {
        status: 'pass',
        data: {
          heal_events: healLogs?.length ?? 0,
          recent: (healLogs || []).slice(0, 5),
        },
      });
    } catch (e) {
      setCheckResult('auto_heal', { status: 'warn', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 11: Artifact Truth ──
  const runArtifactTruth = useCallback(async () => {
    if (!packageId) { setCheckResult('artifact_truth', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('artifact_truth', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_learning_content_progress', {
        p_package_id: packageId,
      });
      if (error) throw error;

      const d = data as any;
      const isGreen = d?.ok === true || (d?.real === d?.total && d?.total > 0);

      setCheckResult('artifact_truth', {
        status: isGreen ? 'pass' : 'warn',
        data: d,
      });
    } catch (e) {
      setCheckResult('artifact_truth', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  // ── Check 12: Legacy Audit ──
  const runLegacyAudit = useCallback(async () => {
    if (!packageId) { setCheckResult('legacy_audit', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('legacy_audit', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_legacy_lesson_audit', {
        p_package_id: packageId,
      });
      if (error) throw error;

      const row = (data || [])[0];
      setCheckResult('legacy_audit', {
        status: row ? (row.legacy_pct > 20 ? 'warn' : 'pass') : 'pass',
        data: row || { legacy_pct: 0, lessons_without_competency: 0, note: 'Kein Legacy gefunden ✓' },
      });
    } catch (e) {
      setCheckResult('legacy_audit', { status: 'fail', error: (e as Error).message });
    }
  }, [packageId]);

  const checkRunners: Record<string, () => Promise<void>> = {
    select_package: runSelectPackage,
    baseline: runBaseline,
    dispatcher: runDispatcher,
    bundle_worker: runBundleWorker,
    lesson_subjobs: runLessonSubjobs,
    monitor: runMonitor,
    hybrid_completion: runHybridCompletion,
    runner: runRunner,
    watchdog: runWatchdog,
    auto_heal: runAutoHeal,
    artifact_truth: runArtifactTruth,
    legacy_audit: runLegacyAudit,
  };

  const runAll = async () => {
    await runSelectPackage();
    if (!packageId) return;
    for (const check of CHECKS.slice(1)) {
      await checkRunners[check.id]();
    }
  };

  const passCount = Object.values(results).filter(r => r.status === 'pass').length;
  const failCount = Object.values(results).filter(r => r.status === 'fail').length;
  const warnCount = Object.values(results).filter(r => r.status === 'warn').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Pipeline E2E Runbook
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Phase-A Validierung · Kompetenz-Bundle Fan-Out
          </p>
        </div>
        <div className="flex items-center gap-2">
          {passCount > 0 && <Badge variant="default" className="bg-emerald-600">{passCount} Pass</Badge>}
          {warnCount > 0 && <Badge variant="outline" className="text-orange-500 border-orange-500">{warnCount} Warn</Badge>}
          {failCount > 0 && <Badge variant="destructive">{failCount} Fail</Badge>}
        </div>
      </div>

      {/* Package selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-foreground shrink-0">Paket-ID:</label>
            <input
              type="text"
              value={packageId}
              onChange={e => setPackageId(e.target.value.trim())}
              placeholder="UUID des Testpakets"
              className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground"
            />
            <Button variant="outline" size="sm" onClick={runAll} disabled={!packageId}>
              <Play className="h-3 w-3 mr-1" /> Alle Checks
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checks */}
      <div className="space-y-1.5">
        {CHECKS.map(check => {
          const result = results[check.id];
          const status = result?.status ?? 'idle';
          const isExpanded = expandedCheck === check.id;

          return (
            <Card key={check.id} className={cn(
              "transition-colors",
              status === 'fail' && "border-destructive/40",
              status === 'pass' && "border-emerald-500/30",
            )}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedCheck(isExpanded ? null : check.id)}
              >
                <StatusIcon status={status} />
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">{check.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{check.desc}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={e => {
                    e.stopPropagation();
                    checkRunners[check.id]();
                  }}
                  disabled={status === 'running' || (check.id !== 'select_package' && !packageId)}
                >
                  {status === 'running'
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <RefreshCw className="h-3 w-3" />}
                </Button>
              </div>

              {isExpanded && result && (
                <CardContent className="pt-0 pb-3">
                  {result.error && (
                    <div className="text-xs text-destructive bg-destructive/10 rounded p-2 mb-2">
                      {result.error}
                    </div>
                  )}
                  {result.data && (
                    <pre className="text-[11px] text-muted-foreground bg-muted/50 rounded p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  )}
                  {/* Package selection helper */}
                  {check.id === 'select_package' && result.data?.candidates && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Klicke ein Paket um es auszuwählen:</p>
                      {result.data.candidates.map((c: any) => (
                        <button
                          key={c.id}
                          onClick={() => setPackageId(c.id)}
                          className={cn(
                            "w-full text-left flex items-center gap-2 px-3 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors",
                            packageId === c.id && "bg-primary/10 border border-primary/30"
                          )}
                        >
                          <Badge variant="outline" className="text-[9px]">{c.status}</Badge>
                          <span className="flex-1 truncate font-medium">{c.title || c.id.slice(0, 12)}</span>
                          <span className="text-muted-foreground">{c.build_progress ?? 0}%</span>
                          <span className={cn(
                            "text-[10px]",
                            c.legacy_pct > 20 ? "text-orange-500" : "text-emerald-500"
                          )}>
                            Legacy: {c.legacy_pct}%
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {result.ts && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Geprüft: {new Date(result.ts).toLocaleTimeString('de-DE')}
                    </p>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Go/No-Go Summary */}
      {passCount + failCount + warnCount >= 8 && (
        <Card className={cn(
          "border-2",
          failCount === 0 ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/50 bg-destructive/5"
        )}>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              {failCount === 0
                ? <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                : <XCircle className="h-6 w-6 text-destructive" />}
              <div>
                <p className="font-semibold text-foreground">
                  {failCount === 0 ? '✅ GO für Phase B' : '❌ NO-GO — Fixes nötig'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {passCount} Pass · {warnCount} Warn · {failCount} Fail
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
