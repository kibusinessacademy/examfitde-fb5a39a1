import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCoursePackageDetail } from '@/hooks/useCoursePackages';
import { useActiveCourse } from '@/contexts/ActiveCourseContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Loader2, ArrowLeft, CheckCircle2, XCircle, Clock, Play, Brain,
  Wrench, Shield, Download, RefreshCw, Trash2, FileText,
  ChevronDown, ChevronRight, RotateCcw, Rocket, Activity,
  Unlock, AlertTriangle, Lightbulb, Zap, StopCircle,
  BookOpen, MessageSquare, Bot, ClipboardCheck, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import BuildLiveLog from '@/components/admin/BuildLiveLog';
import ProductModuleStatus from '@/components/admin/ProductModuleStatus';
import CouncilTimeline from '@/components/admin/CouncilTimeline';
import PageExplainer from '@/components/admin/PageExplainer';
import TrackBadge from '@/components/admin/TrackBadge';
import FeatureFlagEditor from '@/components/admin/FeatureFlagEditor';
import { useTrackConfig, type FeatureFlags } from '@/hooks/useTrackConfig';

/* ───── stepper config ───── */
const ALL_PIPELINE_STEPS = [
  { key: 'scaffold_learning_course', label: 'Lernkurs',      icon: BookOpen,       shortLabel: 'Kurs',  flag: 'has_learning_course' },
  { key: 'generate_exam_pool',      label: 'Prüfungsfragen', icon: ClipboardCheck, shortLabel: 'Exam',  flag: 'has_exam_trainer' },
  { key: 'generate_oral_exam',      label: 'Mündliche',      icon: MessageSquare,  shortLabel: 'Oral',  flag: 'has_oral_exam_trainer' },
  { key: 'build_ai_tutor_index',    label: 'AI Tutor',       icon: Bot,            shortLabel: 'Tutor', flag: 'has_ai_tutor' },
  { key: 'generate_handbook',       label: 'Handbuch',       icon: FileText,       shortLabel: 'Buch',  flag: 'has_handbook' },
  { key: 'run_integrity_check',     label: 'Qualitätsprüfung', icon: Shield,       shortLabel: 'QA',    flag: null },
  { key: 'auto_publish',            label: 'Veröffentlichen', icon: Rocket,        shortLabel: 'Pub',   flag: null },
];

/* ───── error diagnosis ───── */
const ERROR_HINTS: Record<string, { cause: string; fix: string }> = {
  INVALID_COMPETENCY_REF: { cause: 'Kompetenz-ID existiert nicht im Curriculum', fix: 'Lessons neu generieren' },
  MISSING_COURSE_ID: { cause: 'Kurs-ID wurde nicht korrekt übergeben', fix: 'Build erneut starten' },
  INTEGRITY_ERROR: { cause: 'Soll-Ist-Abgleich fehlgeschlagen', fix: 'Integrity Check erneut ausführen' },
  DUPLICATE_LESSON: { cause: 'Doppelte Lektion erkannt', fix: 'Duplikate bereinigen lassen' },
  LLM_TIMEOUT: { cause: 'KI-Antwort Timeout', fix: 'Step erneut versuchen' },
  MISSING_API_KEY: { cause: 'API-Key nicht konfiguriert', fix: 'API-Keys in den Einstellungen prüfen' },
  PREREQ_NOT_DONE: { cause: 'Vorheriger Schritt noch nicht abgeschlossen', fix: 'Wird automatisch erneut versucht (15s)' },
  GENERATION_LOCKED: { cause: 'Generierung läuft bereits', fix: 'Warten oder Lock aufheben' },
};

function diagnoseError(errorMessage: string | null): { cause: string; fix: string } | null {
  if (!errorMessage) return null;
  const upper = errorMessage.toUpperCase();
  for (const [key, hint] of Object.entries(ERROR_HINTS)) {
    if (upper.includes(key) || upper.includes(key.replace(/_/g, ' '))) return hint;
  }
  if (upper.includes('TIMEOUT') || upper.includes('TIMED OUT')) return ERROR_HINTS.LLM_TIMEOUT;
  if (upper.includes('API_KEY') || upper.includes('API KEY')) return ERROR_HINTS.MISSING_API_KEY;
  if (upper.includes('DUPLICATE') || upper.includes('UNIQUE')) return ERROR_HINTS.DUPLICATE_LESSON;
  return null;
}

/* ───── integrity report display ───── */
function IntegrityReportCard({ report }: { report: any }) {
  if (!report || typeof report !== 'object') return null;
  const score = report.score ?? 0;
  const passed = report.passed ?? (score >= 80);

  // Support both legacy format (report.lessons.actual) and v3 format (report.v3.stats)
  const v3 = report.v3?.stats;
  const sections = [
    { label: 'Lektionen',
      actual: report.lessons?.actual ?? v3?.lessonCount ?? null,
      expected: report.lessons?.expected ?? v3?.lessonTarget ?? null,
      icon: BookOpen,
      detail: report.lessons?.duplicates > 0 ? `${report.lessons.duplicates} Duplikate` : null },
    { label: 'Prüfungsfragen',
      actual: report.exam?.total ?? v3?.questionCount ?? null,
      expected: report.exam?.target ?? v3?.questionTarget ?? 850,
      icon: ClipboardCheck,
      detail: report.exam?.approved ? `${report.exam.approved} freigegeben` : null },
    { label: 'Mündliche Szenarien',
      actual: report.oral?.total ?? v3?.oralCount ?? null,
      expected: report.oral?.target ?? v3?.oralTarget ?? null,
      icon: MessageSquare },
    { label: 'Handbuch-Kapitel',
      actual: report.handbook?.chapters ?? v3?.handbookChapters ?? null,
      expected: report.handbook?.target ?? v3?.handbookTarget ?? null,
      icon: FileText,
      detail: report.handbook?.sections ? `${report.handbook.sections} Abschnitte` : null },
    { label: 'AI Tutor Index',
      actual: (report.tutor_index || v3?.tutorIndex) ? 1 : 0,
      expected: 1, icon: Bot },
  ];

  return (
    <Card className={cn("border", passed ? "border-success/30" : "border-destructive/30")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Qualitätsbericht
          </span>
          <span className={cn("text-lg font-bold", score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive")}>
            {score}/100
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sections.map(s => {
          const pct = s.expected > 0 ? Math.min(100, Math.round((s.actual / s.expected) * 100)) : 0;
          const ok = s.actual >= s.expected;
          const Icon = s.icon;
          // Skip sections with no data at all
          if (s.actual == null && s.expected == null) return null;
          return (
            <div key={s.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" /> {s.label}
                </span>
                <span className={cn("font-mono", ok ? "text-success" : "text-warning")}>
                  {s.actual ?? 0}{s.expected != null ? `/${s.expected}` : ''}
                  {s.detail && <span className="text-muted-foreground ml-1">({s.detail})</span>}
                </span>
              </div>
              {s.expected != null && <Progress value={pct} className="h-1" />}
            </div>
          );
        })}

        {/* Exam difficulty distribution */}
        {report.exam?.difficulty && Object.keys(report.exam.difficulty).length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Schwierigkeitsverteilung</p>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(report.exam.difficulty).map(([level, count]) => (
                <Badge key={level} variant="outline" className="text-[10px]">
                  {level}: {String(count)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* LF coverage */}
        {report.exam?.lf_coverage && report.exam.lf_coverage.total > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Lernfeld-Abdeckung:</span>
            <span className={cn("font-mono", report.exam.lf_coverage.covered >= report.exam.lf_coverage.total ? "text-success" : "text-warning")}>
              {report.exam.lf_coverage.covered}/{report.exam.lf_coverage.total}
            </span>
          </div>
        )}

        {/* Issues & Warnings */}
        {((report.issues?.length || 0) + (report.warnings?.length || 0)) > 0 && (
          <div className="mt-3 pt-2 border-t border-border/30 space-y-1">
            {(report.issues || []).map((issue: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-destructive">
                <XCircle className="h-3 w-3 shrink-0" />
                <span>{issue.type?.replace(/_/g, ' ')}: {JSON.stringify(issue).slice(0, 80)}</span>
              </div>
            ))}
            {(report.warnings || []).map((w: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{w.type?.replace(/_/g, ' ')}: {JSON.stringify(w).slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── Auto-Gap-Closer Panel ───── */
function AutoGapCloserPanel({
  packageId, courseId, curriculumId, integrityReport, onRefresh,
}: {
  packageId: string; courseId: string; curriculumId: string;
  integrityReport: any; onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [targetScore, setTargetScore] = useState(85);
  const [autofixRun, setAutofixRun] = useState<any>(null);

  const score = integrityReport?.score ?? 0;
  const deficits = {
    questions: Math.max(0, (integrityReport?.exam?.target || 1000) - (integrityReport?.exam?.total || 0)),
    oral: Math.max(0, (integrityReport?.oral?.target || 20) - (integrityReport?.oral?.total || 0)),
    handbook: Math.max(0, (integrityReport?.handbook?.target || 5) - (integrityReport?.handbook?.chapters || 0)),
    tutor: integrityReport?.tutor_index ? 0 : 1,
  };
  const totalGaps = deficits.questions + deficits.oral + deficits.handbook + deficits.tutor;

  // Poll for active autofix run
  useEffect(() => {
    const fetchRun = async () => {
      const { data } = await (supabase as any).from('autofix_runs')
        .select('*')
        .eq('package_id', packageId)
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setAutofixRun(data);
    };
    fetchRun();
    const iv = setInterval(fetchRun, 10000);
    return () => clearInterval(iv);
  }, [packageId]);

  const handleDryRun = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-gap-close', {
        body: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: targetScore, dry_run: true },
      });
      if (error) throw error;
      setDryRunResult(data);
    } catch (e: any) {
      toast.error(`Preview fehlgeschlagen: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-gap-close', {
        body: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: targetScore },
      });
      if (error) throw error;
      toast.success(`Auto-Fix gestartet (Runde ${data?.round || 1})`);
      setDryRunResult(null);
      onRefresh();
    } catch (e: any) {
      toast.error(`Auto-Fix fehlgeschlagen: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!autofixRun?.id) return;
    await (supabase as any).from('autofix_runs')
      .update({ status: 'stopped', stop_reason: 'Manuell gestoppt' })
      .eq('id', autofixRun.id);
    setAutofixRun(null);
    toast.info('Auto-Fix gestoppt');
    onRefresh();
  };

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-warning" /> Auto-Gap-Closer
          </span>
          <Badge variant="outline" className="text-xs">
            Score: {score}/100 → Ziel: {targetScore}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Deficit summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Fragen', gap: deficits.questions, icon: ClipboardCheck },
            { label: 'Oral', gap: deficits.oral, icon: MessageSquare },
            { label: 'Handbuch', gap: deficits.handbook, icon: FileText },
            { label: 'Tutor', gap: deficits.tutor, icon: Bot },
          ].map(d => (
            <div key={d.label} className={cn("rounded-lg border px-3 py-2 text-center",
              d.gap === 0 ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
              <d.icon className={cn("h-3.5 w-3.5 mx-auto mb-1", d.gap === 0 ? "text-success" : "text-warning")} />
              <p className="text-xs font-medium">{d.label}</p>
              <p className={cn("text-sm font-bold", d.gap === 0 ? "text-success" : "text-warning")}>
                {d.gap === 0 ? '✓' : `-${d.gap}`}
              </p>
            </div>
          ))}
        </div>

        {/* Active run status */}
        {autofixRun && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-primary" /> Auto-Fix läuft
              </span>
              <Badge variant="outline" className="text-[10px]">
                Runde {autofixRun.current_round}/{autofixRun.max_rounds}
              </Badge>
            </div>
            {autofixRun.last_score != null && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Letzter Score:</span>
                <span className="font-bold">{autofixRun.last_score}/100</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleStop} className="text-xs h-7 text-destructive border-destructive/30">
              <StopCircle className="h-3 w-3 mr-1" /> Stoppen
            </Button>
          </div>
        )}

        {/* Dry run result */}
        {dryRunResult?.plan && (
          <div className="bg-muted/30 border border-border/30 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium">Fix-Plan (Preview):</p>
            {dryRunResult.plan.actions?.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{a.job_type.replace(/_/g, ' ')}</span>
                <Badge variant="outline" className="text-[10px]">{a.count}× · {a.scope}</Badge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              Geschätzt: {dryRunResult.plan.estimated_jobs} Jobs
            </p>
          </div>
        )}

        {/* Actions */}
        {!autofixRun && totalGaps > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleDryRun} disabled={loading} className="text-xs h-8">
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Shield className="h-3 w-3 mr-1" />}
              Preview
            </Button>
            <Button size="sm" onClick={handleStart} disabled={loading} className="text-xs h-8">
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Lücken automatisch schließen
            </Button>
            <select
              value={targetScore}
              onChange={e => setTargetScore(Number(e.target.value))}
              className="text-xs h-8 rounded border border-border bg-background px-2"
            >
              <option value={60}>Ziel: 60</option>
              <option value={75}>Ziel: 75</option>
              <option value={85}>Ziel: 85</option>
              <option value={90}>Ziel: 90</option>
              <option value={95}>Ziel: 95</option>
            </select>
          </div>
        )}

        {totalGaps === 0 && (
          <p className="text-xs text-success flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Alle Lücken geschlossen – bereit für Publish
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ───── main ───── */
export default function CourseWorkspace() {
  const { packageId } = useParams<{ packageId: string }>();
  const navigate = useNavigate();
  if (!packageId) return <div className="p-8 text-center text-muted-foreground">Kein Paket ausgewählt.</div>;
  return <WorkspaceContent packageId={packageId} onBack={() => navigate('/admin/courses')} />;
}

/* ───── workspace content ───── */
function WorkspaceContent({ packageId, onBack }: { packageId: string; onBack: () => void }) {
  const { setCourseId, refresh: refreshContext } = useActiveCourse();
  const {
    package: pkg, packageLoading, buildSteps, councils,
    startBuild, initCouncils, approveCouncils, invalidate,
  } = useCoursePackageDetail(packageId);

  const { track, certType, flags, isExamFirst } = useTrackConfig(pkg as any);
  const PIPELINE_STEPS = ALL_PIPELINE_STEPS.filter(s =>
    s.flag === null || (flags as any)[s.flag] === true
  );

  const [resetting, setResetting] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [rebuildingStep, setRebuildingStep] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  // Auto-refresh while building
  useEffect(() => {
    if (pkg?.status !== 'building') return;
    const interval = setInterval(() => invalidate(), 8000);
    return () => clearInterval(interval);
  }, [pkg?.status, invalidate]);

  useEffect(() => { setCourseId(packageId); return () => setCourseId(null); }, [packageId, setCourseId]);

  const refreshAll = useCallback(() => { invalidate(); refreshContext(); }, [invalidate, refreshContext]);

  /* ── One-click pipeline ── */
  const handleFullPipeline = async () => {
    setPipelineRunning(true);
    try {
      if (councils.length === 0) {
        await initCouncils.mutateAsync();
        toast.info('Councils einberufen...');
      }
      if (!pkg?.council_approved) {
        await approveCouncils.mutateAsync();
        toast.info('Council-Freigabe erteilt...');
      }
      await startBuild.mutateAsync();
      toast.success('Pipeline gestartet – Build läuft automatisch');
      refreshAll();
    } catch (e: any) {
      toast.error(`Pipeline-Fehler: ${e.message}`);
    } finally {
      setPipelineRunning(false);
    }
  };

  /* ── Step rebuild ── */
  const handleRebuildStep = async (stepKey: string) => {
    setRebuildingStep(stepKey);
    try {
      // Reset the step to pending, then re-enqueue
      await (supabase as any).from('course_package_build_steps')
        .update({ status: 'pending', error_message: null, log: null, started_at: null, finished_at: null, duration_ms: null })
        .eq('package_id', packageId).eq('step_key', stepKey);

      const jobPayload = {
        job_type: `package_${stepKey}`,
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        run_after: new Date().toISOString(),
        payload: {
          job_version: 'course_studio_v2',
          package_id: packageId,
          step_key: stepKey,
          course_id: pkg?.course_id,
          curriculum_id: (pkg as any)?.curriculum_id,
          certification_id: pkg?.certification_id,
        },
      };
      await (supabase as any).from('job_queue').insert(jobPayload);
      toast.success(`Step "${stepKey}" wird erneut ausgeführt`);
      refreshAll();
    } catch (e: any) {
      toast.error(`Rebuild fehlgeschlagen: ${e.message}`);
    } finally {
      setRebuildingStep(null);
    }
  };

  /* ── Cancel pipeline ── */
  const handleCancelPipeline = async () => {
    setCancelling(true);
    try {
      // Cancel all pending jobs for this package
      await (supabase as any).from('job_queue')
        .update({ status: 'failed', error: 'Cancelled by admin', last_error: 'Cancelled by admin' })
        .like('payload->>package_id', packageId)
        .in('status', ['pending', 'processing']);

      // Reset package status
      await (supabase as any).from('course_packages')
        .update({ status: 'draft', build_progress: 0 })
        .eq('id', packageId);

      // Release lock
      await (supabase as any).from('course_package_locks')
        .delete().eq('package_id', packageId);

      toast.success('Pipeline abgebrochen');
      refreshAll();
    } catch (e: any) {
      toast.error(`Abbruch fehlgeschlagen: ${e.message}`);
    } finally {
      setCancelling(false);
    }
  };

  /* ── Force unlock ── */
  const handleForceUnlock = async () => {
    try {
      await (supabase as any).from('course_package_locks').delete().eq('package_id', packageId);
      toast.success('Lock aufgehoben');
      refreshAll();
    } catch (e: any) {
      toast.error(`Unlock fehlgeschlagen: ${e.message}`);
    }
  };

  /* ── Safe reset (2-step confirm) ── */
  const handleReset = async () => {
    if (confirmReset < 1) { setConfirmReset(1); return; }
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke('course-reset', {
        body: { packageId },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (error) throw error;
      toast.success('Paket wurde vollständig zurückgesetzt');
      setConfirmReset(0);
      refreshAll();
    } catch (e: any) {
      toast.error(`Reset fehlgeschlagen: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  const handleExport = async () => {
    try {
      toast.info('Export wird erstellt…');
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('export-course-package', {
        body: { packageId },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (error) throw error;
      if (data?.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
        toast.success('Export bereit – Download gestartet');
      } else {
        toast.error('Keine Download-URL erhalten');
      }
    } catch (e: any) {
      toast.error(`Export fehlgeschlagen: ${e.message}`);
    }
  };

  if (packageLoading || !pkg) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  // Compute step states from actual build steps
  const stepMap = new Map<string, any>();
  for (const s of buildSteps) stepMap.set(s.step_key, s);

  const doneCount = buildSteps.filter((s: any) => s.status === 'done').length;
  const totalCount = buildSteps.length || PIPELINE_STEPS.length;
  const failedSteps = buildSteps.filter((s: any) => s.status === 'failed');
  const runningStep = buildSteps.find((s: any) => s.status === 'running');

  // Find current step index for "Step X von 7"
  const currentStepIdx = runningStep
    ? PIPELINE_STEPS.findIndex(s => s.key === runningStep.step_key)
    : failedSteps.length > 0
    ? PIPELINE_STEPS.findIndex(s => s.key === failedSteps[0].step_key)
    : doneCount > 0 ? doneCount - 1 : -1;

  // Health score
  const healthScore = Math.max(0, Math.round(
    (pkg.integrity_passed ? 30 : 0) + (pkg.council_approved ? 10 : 0) +
    (doneCount / Math.max(totalCount, 1) * 40) + (failedSteps.length === 0 ? 20 : Math.max(0, 20 - failedSteps.length * 5))
  ));

  const canPublish = pkg.integrity_passed && pkg.council_approved && buildSteps.every((s: any) => s.status === 'done');
  const isBuilding = pkg.status === 'building';
  const progressPct = pkg.build_progress || Math.round((doneCount / Math.max(totalCount, 1)) * 100);

  return (
    <div className="space-y-6">
      {/* Back */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1" /> Kursliste
        </Button>
      </div>

      <PageExplainer
        title="Wie funktioniert der Course Workspace?"
        description="Der zentrale Arbeitsplatz für ein einzelnes Kurspaket. Hier steuerst du den gesamten Produktions-Workflow: Von der Council-Freigabe über den 7-Step-Build bis zur Veröffentlichung. Drei Tabs geben dir verschiedene Perspektiven."
        workflow={[
          { label: 'Curriculum' },
          { label: 'Council' },
          { label: '7-Step Build', active: true },
          { label: 'Integrity' },
          { label: 'Publish' },
        ]}
        actions={[
          '"Pipeline starten" – Ein Klick startet: Council → Build (7 Steps) → Quality Gate → Auto-Publish',
          '"Build Pipeline" Tab – Visueller 7-Schritte-Stepper: Lernkurs, Exam, Oral, Tutor, Handbuch, QA, Publish',
          '"Produktmodule" Tab – Status aller 6 Module (Learning, Exam, Oral, Tutor, Handbook) mit Counts und Health',
          '"Council" Tab – Council-Diskussionen, Votes, Empfehlungen. Admin kann Approve/Reject überschreiben',
          'Einzelne Steps können per "Retry" erneut ausgeführt werden bei Fehlern',
          '"Abbrechen" – Stoppt die laufende Pipeline und setzt den Status zurück',
          '"Force Unlock" – Hebt Sperren auf, falls ein Build hängen geblieben ist',
          '"Reset" – Vollständiger Reset des Pakets (Doppelklick-Bestätigung)',
        ]}
        tips={[
          'Der Health Score (0-100%) berechnet sich aus: Integrity (30%), Council (10%), Build-Fortschritt (40%), Fehlerfreiheit (20%)',
          'Fehlerdiagnose: Jeder fehlgeschlagene Step zeigt Ursache + Lösungsvorschlag',
          'Das Live Log zeigt Build-Ereignisse in Echtzeit im Terminal-Stil',
          'Integrity Report zeigt Soll/Ist für Lektionen, Fragen, Szenarien, Kapitel',
        ]}
      />

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">{pkg.title || 'Kurspaket'}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <TrackBadge track={track} certType={certType} showCertType />
            <Badge variant="outline" className={cn("text-xs",
              pkg.status === 'published' ? 'bg-success/20 text-success' :
              pkg.status === 'failed' ? 'bg-destructive/20 text-destructive' :
              isBuilding ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              {pkg.status === 'published' ? 'Live' : isBuilding ? 'Build läuft' :
               pkg.status === 'failed' ? 'Fehler' : pkg.status === 'qa' ? 'QA' : 'Draft'}
            </Badge>
            <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
              healthScore >= 95 ? 'bg-success/10 text-success' : healthScore >= 80 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
            )}>
              <Activity className="h-3 w-3" /> {healthScore}%
            </div>
            {isBuilding && runningStep && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary">
                Step {currentStepIdx + 1}/{PIPELINE_STEPS.length}: {PIPELINE_STEPS[currentStepIdx]?.label || runningStep.step_key}
              </Badge>
            )}
            {(pkg as any).queue_position && pkg.status !== 'published' && (
              <Badge variant="outline" className="text-xs">Queue #{(pkg as any).queue_position}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isBuilding && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelPipeline} disabled={cancelling}
                className="text-destructive border-destructive/30">
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <StopCircle className="h-3.5 w-3.5 mr-1" />}
                Abbrechen
              </Button>
              <Button variant="outline" size="sm" onClick={handleForceUnlock} className="text-warning border-warning/30">
                <Unlock className="h-3.5 w-3.5 mr-1" /> Force Unlock
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* ── Tabs: Build | Module | Council | Export ── */}
      <Tabs defaultValue="build" className="space-y-4">
        <TabsList>
          <TabsTrigger value="build">Build Pipeline</TabsTrigger>
          <TabsTrigger value="modules">Produktmodule</TabsTrigger>
          <TabsTrigger value="council">Council</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="space-y-6">

      {/* ── Progress Bar with Step Counter ── */}
      {buildSteps.length > 0 && (
        <Card>
          <CardContent className="py-4">
            {/* Step indicators */}
            <div className="flex items-center gap-0 overflow-x-auto pb-3">
              {PIPELINE_STEPS.map((step, i) => {
                const buildStep = stepMap.get(step.key);
                const status = buildStep?.status || 'pending';
                const Icon = step.icon;
                const isDone = status === 'done';
                const isFailed = status === 'failed';
                const isRunning = status === 'running';

                return (
                  <div key={step.key} className="flex items-center shrink-0">
                    <div className="flex flex-col items-center gap-1 px-1.5 min-w-[56px]">
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center transition-colors",
                        isDone ? 'bg-success text-success-foreground' :
                        isRunning ? 'bg-primary text-primary-foreground' :
                        isFailed ? 'bg-destructive text-destructive-foreground' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                         isFailed ? <XCircle className="h-3.5 w-3.5" /> :
                         isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                         <Icon className="h-3.5 w-3.5" />}
                      </div>
                      <span className={cn("text-[9px] text-center leading-tight",
                        isDone ? 'text-success font-medium' :
                        isRunning ? 'text-primary font-medium' :
                        isFailed ? 'text-destructive font-medium' :
                        'text-muted-foreground'
                      )}>
                        {step.shortLabel}
                      </span>
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && (
                      <div className={cn("w-4 h-0.5 shrink-0", isDone ? 'bg-success' : 'bg-border')} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Overall progress */}
            <div className="flex items-center gap-3">
              <Progress value={progressPct} className="h-2 flex-1" />
              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                {doneCount}/{totalCount} · {progressPct}%
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── One-Click Pipeline ── */}
      {pkg.status !== 'published' && !isBuilding && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" /> Kurs vollständig erstellen
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Council → 7 Build-Steps → Quality Gate → Auto-Publish
              </p>
            </div>
            <Button onClick={handleFullPipeline} disabled={pipelineRunning} size="sm">
              {pipelineRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              Pipeline starten
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Auto-Gap-Closer ── */}
      {pkg.status !== 'published' && !isBuilding && pkg.integrity_report && !(pkg.integrity_report as any)?.passed && (
        <AutoGapCloserPanel
          packageId={packageId}
          courseId={pkg.course_id || ''}
          curriculumId={(pkg as any)?.curriculum_id || ''}
          integrityReport={pkg.integrity_report as any}
          onRefresh={refreshAll}
        />
      )}

      {/* ── Live Build Log ── */}
      <BuildLiveLog packageId={packageId} isBuilding={isBuilding} />

      {/* ── Integrity Report ── */}
      {pkg.integrity_report && typeof pkg.integrity_report === 'object' && (
        <IntegrityReportCard report={pkg.integrity_report} />
      )}

      {/* ── Error Diagnostics ── */}
      {failedSteps.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {failedSteps.length} fehlgeschlagene{failedSteps.length === 1 ? 'r' : ''} Schritt{failedSteps.length !== 1 ? 'e' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failedSteps.map((step: any) => {
              const diagnosis = diagnoseError(step.error_message);
              const stepDef = PIPELINE_STEPS.find(s => s.key === (step.step_key || step.step_name));
              return (
                <div key={step.id || step.step_key} className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{stepDef?.label || step.step_label || step.step_key}</p>
                    <Button variant="outline" size="sm" className="text-xs h-7"
                      onClick={() => handleRebuildStep(step.step_key || step.step_name)}
                      disabled={rebuildingStep === (step.step_key || step.step_name)}>
                      {rebuildingStep === (step.step_key || step.step_name) ?
                        <Loader2 className="h-3 w-3 animate-spin mr-1" /> :
                        <RotateCcw className="h-3 w-3 mr-1" />}
                      Retry
                    </Button>
                  </div>
                  {step.error_message && (
                    <p className="text-xs text-destructive mt-1 font-mono truncate max-w-full">{step.error_message}</p>
                  )}
                  {diagnosis && (
                    <div className="mt-2 flex items-start gap-2 bg-warning/5 border border-warning/20 rounded p-2">
                      <Lightbulb className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <p className="text-foreground"><strong>Ursache:</strong> {diagnosis.cause}</p>
                        <p className="text-muted-foreground"><strong>Lösung:</strong> {diagnosis.fix}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Build Steps Detail (Live Log) ── */}
      {buildSteps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Build-Schritte</span>
              <span className="text-xs font-normal text-muted-foreground">
                {isBuilding && '⟳ Auto-Refresh alle 8s'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {PIPELINE_STEPS.map((stepDef, idx) => {
                const step = stepMap.get(stepDef.key);
                const status = step?.status || 'queued';
                const isDone = status === 'done';
                const isFailed = status === 'failed';
                const isRunning = status === 'running';
                const stepKey = stepDef.key;
                const isExpanded = expandedStep === stepKey;
                const hasDetails = step?.log || step?.error_message;
                const Icon = stepDef.icon;

                return (
                  <div key={stepKey} className={cn("border rounded-lg transition-colors",
                    isRunning ? "border-primary/40 bg-primary/5" : "border-border/30")}>
                    <button
                      className="w-full flex items-center justify-between gap-3 py-2.5 px-3 text-left hover:bg-muted/30 rounded-lg transition-colors"
                      onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground w-4 text-center">{idx + 1}</span>
                        {isDone ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> :
                         isFailed ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> :
                         isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> :
                         <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{stepDef.label}</span>
                        {step?.duration_ms && (
                          <span className="text-[10px] text-muted-foreground">({(step.duration_ms / 1000).toFixed(1)}s)</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(isDone || isFailed) && !isBuilding && (
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                            onClick={(e) => { e.stopPropagation(); handleRebuildStep(stepKey); }}
                            disabled={rebuildingStep === stepKey}>
                            <RotateCcw className="h-3 w-3 mr-0.5" /> Retry
                          </Button>
                        )}
                        <Badge variant="outline" className={cn("text-[10px]",
                          isDone ? 'bg-success/10 text-success' :
                          isFailed ? 'bg-destructive/10 text-destructive' :
                          isRunning ? 'bg-primary/10 text-primary' : ''
                        )}>
                          {status}
                        </Badge>
                        {hasDetails && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                      </div>
                    </button>
                    {isExpanded && hasDetails && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        {step?.error_message && (
                          <p className="text-xs text-destructive bg-destructive/5 p-2 rounded font-mono break-all">{step.error_message}</p>
                        )}
                        {step?.log && Object.keys(step.log).length > 0 && (
                          <div className="bg-muted/30 p-2 rounded space-y-1">
                            {Object.entries(step.log as Record<string, unknown>)
                              .filter(([k]) => k !== 'ok' && k !== 'note')
                              .map(([key, val]) => (
                                <div key={key} className="flex items-center justify-between text-[11px]">
                                  <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                                  <span className="font-mono text-foreground">
                                    {typeof val === 'boolean' ? (val ? '✅' : '❌') :
                                     typeof val === 'number' ? val.toLocaleString('de-DE') :
                                     typeof val === 'string' ? val :
                                     JSON.stringify(val)}
                                  </span>
                                </div>
                              ))}
                            {(step.log as any)?.note && (
                              <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/20">
                                {(step.log as any).note}
                              </p>
                            )}
                          </div>
                        )}
                        {step?.started_at && (
                          <p className="text-[10px] text-muted-foreground">
                            Gestartet: {new Date(step.started_at).toLocaleString('de-DE')}
                            {step?.finished_at && ` · Fertig: ${new Date(step.finished_at).toLocaleString('de-DE')}`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Export Action ── */}
      {(pkg.status === 'published' || canPublish) && (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      )}

        </TabsContent>

        <TabsContent value="modules">
          <ProductModuleStatus packageId={packageId} courseId={pkg.course_id || null} certificationId={pkg.certification_id || null} featureFlags={(pkg as any)?.feature_flags} />
        </TabsContent>

        <TabsContent value="council">
          <CouncilTimeline packageId={packageId} councils={councils} onRefresh={refreshAll} />
        </TabsContent>

        <TabsContent value="export">
          <ExportTab pkg={pkg} packageId={packageId} />
        </TabsContent>
      </Tabs>

      {/* ── Danger Zone (2-step confirm) ── */}
      <div className="pt-4">
        <button onClick={() => { setShowDanger(!showDanger); setConfirmReset(0); }}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1">
          {showDanger ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Danger Zone
        </button>
        {showDanger && (
          <Card className="mt-3 border-destructive/30">
            <CardContent className="py-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-destructive">Kurspaket vollständig zurücksetzen</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Löscht: Locks, Jobs, Lessons, Modules, Exam Questions, Tutor Index, Handbook, Package Steps.
                </p>
              </div>
              {confirmReset === 0 && (
                <Button variant="destructive" size="sm" onClick={handleReset}>
                  <Trash2 className="h-4 w-4 mr-1" /> Reset anfordern
                </Button>
              )}
              {confirmReset === 1 && (
                <div className="flex items-center gap-3 bg-destructive/10 p-3 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive">Wirklich zurücksetzen?</p>
                    <p className="text-xs text-muted-foreground">Diese Aktion kann nicht rückgängig gemacht werden.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirmReset(0)}>Abbrechen</Button>
                    <Button variant="destructive" size="sm" onClick={handleReset} disabled={resetting}>
                      {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                      Endgültig löschen
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ───── Export Tab ───── */
function ExportTab({ pkg, packageId }: { pkg: any; packageId: string }) {
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [jsxExportUrl, setJsxExportUrl] = useState<string | null>(null);
  const [jsxExporting, setJsxExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-course-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) {
        setExportUrl(resData.downloadUrl as string);
        toast.success('ZIP-Export erstellt');
      }
    } catch (e: any) {
      toast.error(`Export-Fehler: ${e?.message || 'Unbekannt'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleJsxExport = async () => {
    setJsxExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-jsx-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) {
        setJsxExportUrl(resData.downloadUrl as string);
        const a = document.createElement('a');
        a.href = resData.downloadUrl as string;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('JSX Export erstellt – Download geöffnet');
      }
    } catch (e: any) {
      toast.error(`JSX Export-Fehler: ${e?.message || 'Unbekannt'}`);
    } finally {
      setJsxExporting(false);
    }
  };

  const exports = [
    { key: 'zip', label: 'ZIP Package Export', desc: 'Komplett: Lernkurs + Fragen + Oral + Tutor + Handbuch', icon: '📦', action: handleExport, actionLabel: 'Exportieren', loading: exporting },
    { key: 'jsx', label: 'JSX Export', desc: 'React/Content Pack (Module + Lessons + Handbuch)', icon: '⚛️', action: handleJsxExport, actionLabel: 'JSX Exportieren', loading: jsxExporting },
    { key: 'json', label: 'JSON SSOT Snapshot', desc: 'Curriculum + Plan + Blueprints + Coverage', icon: '🗂' },
    { key: 'csv', label: 'Questions CSV/QTI', desc: 'Fragenpool als CSV oder QTI-Format', icon: '📊' },
    { key: 'handbook', label: 'Handbuch PDF/MD', desc: 'Handbuch als PDF oder Markdown', icon: '📖' },
  ];

  return (
    <div className="space-y-4">
      {exportUrl && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">ZIP-Export bereit</p>
              <p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p>
            </div>
            <Button size="sm" asChild>
              <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" /> Herunterladen
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {jsxExportUrl && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">JSX Export bereit</p>
              <p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p>
            </div>
            <Button size="sm" asChild>
              <a href={jsxExportUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" /> Herunterladen
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {exports.map(exp => (
          <Card key={exp.key} className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{exp.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{exp.label}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{exp.desc}</p>
                  {exp.action ? (
                    <Button variant="outline" size="sm" className="mt-2" onClick={exp.action} disabled={exp.loading || pkg.status === 'planning'}>
                      {exp.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                      {exp.actionLabel}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-2" disabled={pkg.status !== 'published'}>
                      <Download className="h-3 w-3 mr-1" /> Exportieren
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
