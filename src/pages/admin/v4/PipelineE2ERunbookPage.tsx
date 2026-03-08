import { useState, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, XCircle, Loader2, Play,
  AlertTriangle, RefreshCw, ChevronDown, ChevronRight, FlaskConical, Eye, Server
} from 'lucide-react';

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn';

interface CheckResult {
  status: CheckStatus;
  data?: any;
  error?: string;
  ts?: string;
}

type CheckGate = 'p0' | 'soft';

const CHECKS: readonly { id: string; label: string; desc: string; gate: CheckGate }[] = [
  { id: 'select_package', label: '1. Testpaket auswählen', desc: 'Package mit niedrigem Legacy-Anteil finden', gate: 'soft' },
  { id: 'baseline', label: '2. Ausgangszustand', desc: 'needs_regen, bundles, artifact status', gate: 'p0' },
  { id: 'dispatcher', label: '3. Dispatcher', desc: 'Bundle-Jobs erzeugt? Dedup sauber?', gate: 'p0' },
  { id: 'bundle_worker', label: '4. Bundle-Worker', desc: 'Lesson-Subjobs korrekt enqueued?', gate: 'p0' },
  { id: 'lesson_subjobs', label: '5. Lesson-Subjobs', desc: 'Content valide? Kein Hollow?', gate: 'p0' },
  { id: 'monitor', label: '6. Bundle-Monitor', desc: 'Metriken plausibel?', gate: 'soft' },
  { id: 'hybrid_completion', label: '7. Hybrid-Completion', desc: 'check_fan_out_completion korrekt?', gate: 'p0' },
  { id: 'runner', label: '8. Runner', desc: 'Step sauber auf done? Kein Loop?', gate: 'soft' },
  { id: 'watchdog', label: '9. Watchdog', desc: 'Keine unnötigen Resets?', gate: 'soft' },
  { id: 'auto_heal', label: '10. Auto-Heal', desc: 'Recovery logisch? (optional)', gate: 'soft' },
  { id: 'artifact_truth', label: '11. Artefakt-Truth', desc: 'get_learning_content_progress grün?', gate: 'p0' },
  { id: 'legacy_audit', label: '12. Legacy-Audit', desc: 'Legacy messbar?', gate: 'soft' },
];

const P0_IDS = CHECKS.filter(c => c.gate === 'p0').map(c => c.id);

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'pass': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'fail': return <XCircle className="h-4 w-4 text-destructive" />;
    case 'warn': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    default: return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;
  }
}

type Verdict = 'GO' | 'GO_WITH_WARNINGS' | 'NO_GO' | 'INCOMPLETE';

function VerdictBanner({ verdict, p0Pass, p0Fail, softPass, softWarn }: {
  verdict: Verdict; p0Pass: number; p0Fail: number; softPass: number; softWarn: number;
}) {
  const config = {
    GO: { icon: <CheckCircle2 className="h-6 w-6 text-emerald-500" />, label: '✅ GO für Phase B', border: 'border-emerald-500/50 bg-emerald-500/5' },
    GO_WITH_WARNINGS: { icon: <AlertTriangle className="h-6 w-6 text-orange-500" />, label: '⚠️ GO MIT VORBEHALTEN', border: 'border-orange-500/50 bg-orange-500/5' },
    NO_GO: { icon: <XCircle className="h-6 w-6 text-destructive" />, label: '❌ NO-GO — P0-Fails beheben', border: 'border-destructive/50 bg-destructive/5' },
    INCOMPLETE: { icon: <Eye className="h-6 w-6 text-muted-foreground" />, label: '⏳ Checks unvollständig', border: 'border-border' },
  };
  const c = config[verdict];
  return (
    <Card className={cn("border-2", c.border)}>
      <CardContent className="py-4">
        <div className="flex items-center gap-3">
          {c.icon}
          <div>
            <p className="font-semibold text-foreground">{c.label}</p>
            <p className="text-sm text-muted-foreground">
              P0: {p0Pass} Pass / {p0Fail} Fail · Soft: {softPass} Pass / {softWarn} Warn
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PipelineE2ERunbookPage() {
  const [packageId, setPackageId] = useState('');
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [serverReport, setServerReport] = useState<any>(null);
  const [serverRunning, setServerRunning] = useState(false);
  // Ref to pass packageId into runAll without stale closure
  const pkgRef = useRef(packageId);
  pkgRef.current = packageId;

  const setCheckResult = (id: string, result: CheckResult) => {
    setResults(prev => ({ ...prev, [id]: { ...result, ts: new Date().toISOString() } }));
  };

  const usePkg = (override?: string) => override || pkgRef.current;

  // ── Check 1: Find best test package (returns selected ID) ──
  const runSelectPackage = useCallback(async (): Promise<string | null> => {
    setCheckResult('select_package', { status: 'running' });
    try {
      const { data: audit, error } = await (supabase as any).rpc('get_legacy_lesson_audit');
      if (error) throw error;

      const { data: pkgs } = await (supabase as any)
        .from('course_packages')
        .select('id,title,status,build_progress,updated_at')
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

      // Rank: building first, then lowest legacy_pct + legacy_count
      const ranked = [...candidates].sort((a, b) => {
        const scoreA = (a.status === 'building' ? 0 : 10) + (a.legacy_pct ?? 0) + (a.legacy_count ?? 0) * 0.5;
        const scoreB = (b.status === 'building' ? 0 : 10) + (b.legacy_pct ?? 0) + (b.legacy_count ?? 0) * 0.5;
        return scoreA - scoreB;
      });

      const best = ranked[0]?.id ?? null;
      if (best && !pkgRef.current) setPackageId(best);

      setCheckResult('select_package', {
        status: ranked.length > 0 ? 'pass' : 'warn',
        data: { candidates: ranked, suggested_package_id: best, audit_summary: audit?.length ?? 0 },
      });
      return best;
    } catch (e) {
      setCheckResult('select_package', { status: 'fail', error: (e as Error).message });
      return null;
    }
  }, []);

  // ── Check 2: Baseline ──
  const runBaseline = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('baseline', { status: 'fail', error: 'Kein Paket ausgewählt' }); return; }
    setCheckResult('baseline', { status: 'running' });
    try {
      const [bundleRes, stepRes, progressRes] = await Promise.all([
        (supabase as any).rpc('get_competency_bundle_progress', { p_package_id: pid }),
        (supabase as any).from('package_steps').select('status,meta,attempts')
          .eq('package_id', pid).eq('step_key', 'generate_learning_content').maybeSingle(),
        (supabase as any).rpc('get_learning_content_progress', { p_package_id: pid }),
      ]);
      setCheckResult('baseline', {
        status: 'pass',
        data: { bundle_progress: bundleRes.data, step: stepRes.data, artifact_progress: progressRes.data },
      });
    } catch (e) {
      setCheckResult('baseline', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 3: Dispatcher ──
  const runDispatcher = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('dispatcher', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('dispatcher', { status: 'running' });
    try {
      const { data: bundleJobs, error } = await (supabase as any)
        .from('job_queue')
        .select('id,status,batch_cursor,idempotency_key,created_at')
        .eq('package_id', pid)
        .eq('job_type', 'lesson_generate_competency_bundle')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;

      const competencyIds = (bundleJobs || []).map((j: any) => j.batch_cursor?.competency_id).filter(Boolean);
      const uniqueCompetencies = new Set(competencyIds);
      const hasDupes = competencyIds.length !== uniqueCompetencies.size;

      const { data: legacyJobs } = await (supabase as any)
        .from('job_queue').select('id,status')
        .eq('package_id', pid).eq('job_type', 'lesson_generate_content')
        .in('status', ['pending', 'processing', 'queued']).limit(50);

      setCheckResult('dispatcher', {
        status: hasDupes ? 'fail' : (bundleJobs?.length > 0 ? 'pass' : 'warn'),
        data: {
          bundle_jobs: bundleJobs?.length ?? 0,
          unique_competencies: uniqueCompetencies.size,
          has_duplicates: hasDupes,
          legacy_active: legacyJobs?.length ?? 0,
          sample_jobs: (bundleJobs || []).slice(0, 5).map((j: any) => ({
            id: j.id.slice(0, 8), status: j.status, competency: j.batch_cursor?.competency_id?.slice(0, 8),
          })),
        },
      });
    } catch (e) {
      setCheckResult('dispatcher', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 4: Bundle Worker ──
  const runBundleWorker = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('bundle_worker', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('bundle_worker', { status: 'running' });
    try {
      const { data: doneBundles } = await (supabase as any)
        .from('job_queue').select('id,batch_cursor,payload')
        .eq('package_id', pid).eq('job_type', 'lesson_generate_competency_bundle')
        .eq('status', 'done').limit(5);

      const sampleCompetencies = (doneBundles || [])
        .map((b: any) => b.batch_cursor?.competency_id || b.payload?.competency_id)
        .filter(Boolean).slice(0, 3);

      const samples = [];
      for (const cid of sampleCompetencies) {
        const { data: lessonJobs } = await (supabase as any)
          .from('job_queue').select('id,status,batch_cursor')
          .eq('package_id', pid).eq('job_type', 'lesson_generate_content').limit(200);

        const matching = (lessonJobs || []).filter((j: any) => j.batch_cursor?.competency_id === cid);
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
        data: { done_bundles: doneBundles?.length ?? 0, samples },
      });
    } catch (e) {
      setCheckResult('bundle_worker', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 5: Lesson Subjobs (SSOT: content.html check) ──
  const runLessonSubjobs = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('lesson_subjobs', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('lesson_subjobs', { status: 'running' });
    try {
      const { data: doneJobs } = await (supabase as any)
        .from('job_queue').select('id,payload')
        .eq('package_id', pid).eq('job_type', 'lesson_generate_content')
        .eq('status', 'done').limit(10);

      const lessonIds = (doneJobs || []).map((j: any) => j.payload?.lesson_id).filter(Boolean).slice(0, 5);

      const samples = [];
      for (const lid of lessonIds) {
        const { data: lesson } = await (supabase as any)
          .from('lessons').select('id,title,competency_id,content,qc_status')
          .eq('id', lid).maybeSingle();

        if (lesson) {
          // SSOT: check content.html specifically
          const content = lesson.content;
          const html = content && typeof content === 'object' ? (content.html || '') : '';
          const isPlaceholder = String(content?._placeholder) === 'true';
          const isHollow = !html || html.length < 600 || isPlaceholder;
          const hasJsonFence = html.includes('```json');

          samples.push({
            id: lesson.id.slice(0, 8),
            title: lesson.title?.slice(0, 40),
            competency_id: lesson.competency_id?.slice(0, 8) ?? 'NULL',
            html_length: html.length,
            is_hollow: isHollow,
            is_placeholder: isPlaceholder,
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
  }, []);

  // ── Check 6: Monitor metrics ──
  const runMonitor = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('monitor', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('monitor', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_competency_bundle_progress', { p_package_id: pid });
      if (error) throw error;
      const d = data as any;
      const consistent = d.bundles_done + d.bundles_failed + d.bundles_active <= d.bundles_total;
      setCheckResult('monitor', { status: consistent ? 'pass' : 'fail', data: { ...d, consistent } });
    } catch (e) {
      setCheckResult('monitor', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 7: Hybrid Completion ──
  const runHybridCompletion = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('hybrid_completion', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('hybrid_completion', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('check_fan_out_completion', {
        p_package_id: pid, p_step_key: 'generate_learning_content',
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
  }, []);

  // ── Check 8: Runner ──
  const runRunner = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('runner', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('runner', { status: 'running' });
    try {
      const { data: step } = await (supabase as any)
        .from('package_steps').select('status,attempts,meta,last_error,finished_at')
        .eq('package_id', pid).eq('step_key', 'generate_learning_content').maybeSingle();
      const isDone = step?.status === 'done';
      const isLooping = (step?.attempts ?? 0) > 10;
      setCheckResult('runner', {
        status: isDone ? 'pass' : (isLooping ? 'fail' : 'warn'),
        data: {
          status: step?.status, attempts: step?.attempts, finished_at: step?.finished_at,
          is_looping: isLooping,
          meta_snippet: step?.meta ? { dispatcher_mode: step.meta.dispatcher_mode, needs_regen: step.meta.needs_regen } : null,
          last_error: step?.last_error?.slice(0, 200),
        },
      });
    } catch (e) {
      setCheckResult('runner', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 9: Watchdog ──
  const runWatchdog = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('watchdog', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('watchdog', { status: 'running' });
    try {
      const { data: events } = await (supabase as any)
        .from('pipeline_health_events').select('event_type,message,created_at')
        .eq('package_id', pid).order('created_at', { ascending: false }).limit(20);
      const suspiciousResets = (events || []).filter(
        (e: any) => e.event_type === 'step_reset' || e.message?.includes('watchdog')
      );
      setCheckResult('watchdog', {
        status: suspiciousResets.length > 3 ? 'fail' : 'pass',
        data: { total_events: events?.length ?? 0, suspicious_resets: suspiciousResets.length, recent: (events || []).slice(0, 5) },
      });
    } catch {
      setCheckResult('watchdog', { status: 'warn', data: { note: 'Events-Tabelle nicht verfügbar' } });
    }
  }, []);

  // ── Check 10: Auto-Heal ──
  const runAutoHeal = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('auto_heal', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('auto_heal', { status: 'running' });
    try {
      const { data: healLogs } = await (supabase as any)
        .from('auto_heal_log').select('action_type,result_status,target_id,created_at')
        .eq('target_id', pid).order('created_at', { ascending: false }).limit(10);
      setCheckResult('auto_heal', {
        status: 'pass',
        data: { heal_events: healLogs?.length ?? 0, recent: (healLogs || []).slice(0, 5) },
      });
    } catch (e) {
      setCheckResult('auto_heal', { status: 'warn', error: (e as Error).message });
    }
  }, []);

  // ── Check 11: Artifact Truth ──
  const runArtifactTruth = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('artifact_truth', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('artifact_truth', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_learning_content_progress', { p_package_id: pid });
      if (error) throw error;
      const d = data as any;
      const isGreen = d?.ok === true || (d?.real === d?.total && d?.total > 0);
      setCheckResult('artifact_truth', { status: isGreen ? 'pass' : 'warn', data: d });
    } catch (e) {
      setCheckResult('artifact_truth', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Check 12: Legacy Audit ──
  const runLegacyAudit = useCallback(async (override?: string) => {
    const pid = usePkg(override);
    if (!pid) { setCheckResult('legacy_audit', { status: 'fail', error: 'Kein Paket' }); return; }
    setCheckResult('legacy_audit', { status: 'running' });
    try {
      const { data, error } = await (supabase as any).rpc('get_legacy_lesson_audit', { p_package_id: pid });
      if (error) throw error;
      const row = (data || [])[0];
      setCheckResult('legacy_audit', {
        status: row ? (row.legacy_pct > 20 ? 'warn' : 'pass') : 'pass',
        data: row || { legacy_pct: 0, lessons_without_competency: 0, note: 'Kein Legacy gefunden ✓' },
      });
    } catch (e) {
      setCheckResult('legacy_audit', { status: 'fail', error: (e as Error).message });
    }
  }, []);

  // ── Runner map (all accept optional override) ──
  const checkRunners: Record<string, (override?: string) => Promise<any>> = {
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

  // ── Run All (client-side): uses ref or auto-selects ──
  const runAll = async () => {
    let pid = pkgRef.current;
    if (!pid) {
      const selected = await runSelectPackage();
      if (!selected) return;
      pid = selected;
      setPackageId(pid);
    }
    for (const check of CHECKS.slice(1)) {
      await checkRunners[check.id](pid);
    }
  };

  // ── Run All Server-Side via Edge Function ──
  const runServerSide = async () => {
    setServerRunning(true);
    setServerReport(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-run-pipeline-e2e', {
        body: { package_id: packageId || undefined, auto_select: true },
      });
      if (error) throw error;
      setServerReport(data);
      // Hydrate local check results from server report
      if (data?.checks) {
        for (const [id, check] of Object.entries(data.checks as Record<string, any>)) {
          setCheckResult(id, { status: check.status, data: check.data, error: check.error });
        }
      }
      if (data?.selected_package_id && !packageId) {
        setPackageId(data.selected_package_id);
      }
    } catch (e) {
      setServerReport({ verdict: 'ERROR', error: (e as Error).message });
    } finally {
      setServerRunning(false);
    }
  };

  // ── Verdict calculation ──
  const p0Results = P0_IDS.map(id => results[id]?.status).filter(Boolean);
  const p0Pass = p0Results.filter(s => s === 'pass').length;
  const p0Fail = p0Results.filter(s => s === 'fail').length;
  const softResults = CHECKS.filter(c => c.gate === 'soft').map(c => results[c.id]?.status).filter(Boolean);
  const softPass = softResults.filter(s => s === 'pass').length;
  const softWarn = softResults.filter(s => s === 'warn' || s === 'fail').length;

  // P0-complete only when every P0 check has a terminal status
  const p0Complete = P0_IDS.every(id => {
    const s = results[id]?.status;
    return s && s !== 'idle' && s !== 'running';
  });

  const verdict: Verdict =
    !p0Complete ? 'INCOMPLETE'
    : p0Fail > 0 ? 'NO_GO'
    : softWarn > 0 ? 'GO_WITH_WARNINGS'
    : p0Pass >= P0_IDS.length ? 'GO'
    : 'INCOMPLETE';

  return (
    <div className="space-y-6">
      {/* Header */}
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
          {p0Pass > 0 && <Badge variant="default" className="bg-emerald-600">P0: {p0Pass}/{P0_IDS.length}</Badge>}
          {p0Fail > 0 && <Badge variant="destructive">P0 Fail: {p0Fail}</Badge>}
          {softWarn > 0 && <Badge variant="outline" className="text-orange-500 border-orange-500">Soft: {softWarn} Warn</Badge>}
        </div>
      </div>

      {/* Verdict (always visible) */}
      <VerdictBanner verdict={verdict} p0Pass={p0Pass} p0Fail={p0Fail} softPass={softPass} softWarn={softWarn} />

      {/* Package selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-foreground shrink-0">Paket-ID:</label>
            <input
              type="text"
              value={packageId}
              onChange={e => setPackageId(e.target.value.trim())}
              placeholder="UUID des Testpakets (oder Check 1 wählt automatisch)"
              className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground"
            />
            <Button variant="outline" size="sm" onClick={runAll}>
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
          const isP0 = check.gate === 'p0';

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
                  {isP0
                    ? <Badge variant="outline" className="ml-2 text-[9px] h-4 border-primary/50 text-primary">P0</Badge>
                    : <Badge variant="outline" className="ml-2 text-[9px] h-4 border-muted-foreground/40 text-muted-foreground">SOFT</Badge>
                  }
                  <span className="text-xs text-muted-foreground ml-2">{check.desc}</span>
                </div>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs shrink-0"
                  onClick={e => { e.stopPropagation(); checkRunners[check.id](); }}
                  disabled={status === 'running' || (check.id !== 'select_package' && !packageId)}
                >
                  {status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                </Button>
              </div>

              {isExpanded && result && (
                <CardContent className="pt-0 pb-3">
                  {result.error && (
                    <div className="text-xs text-destructive bg-destructive/10 rounded p-2 mb-2">{result.error}</div>
                  )}
                  {result.data && (
                    <pre className="text-[11px] text-muted-foreground bg-muted/50 rounded p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  )}
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
                          <span className={cn("text-[10px]", c.legacy_pct > 20 ? "text-orange-500" : "text-emerald-500")}>
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
    </div>
  );
}
