import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCoursePackageDetail } from '@/hooks/useCoursePackages';
import { useActiveCourse } from '@/contexts/ActiveCourseContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, ArrowLeft, CheckCircle2, XCircle, Clock, Play, Brain,
  Wrench, Shield, Download, RefreshCw, Trash2, FileText,
  ChevronDown, ChevronRight, RotateCcw, Rocket, Activity,
  Unlock, AlertTriangle, Lightbulb, Zap, StopCircle,
  BookOpen, MessageSquare, Bot, ClipboardCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import BuildLiveLog from '@/components/admin/BuildLiveLog';

/* ───── stepper config ───── */
const PIPELINE_STEPS = [
  { key: 'scaffold_learning_course', label: 'Lernkurs',      icon: BookOpen,       shortLabel: 'Kurs' },
  { key: 'generate_exam_pool',      label: 'Prüfungsfragen', icon: ClipboardCheck, shortLabel: 'Exam' },
  { key: 'generate_oral_exam',      label: 'Mündliche',      icon: MessageSquare,  shortLabel: 'Oral' },
  { key: 'build_ai_tutor_index',    label: 'AI Tutor',       icon: Bot,            shortLabel: 'Tutor' },
  { key: 'generate_handbook',       label: 'Handbuch',       icon: FileText,       shortLabel: 'Buch' },
  { key: 'run_integrity_check',     label: 'Qualitätsprüfung', icon: Shield,       shortLabel: 'QA' },
  { key: 'auto_publish',            label: 'Veröffentlichen', icon: Rocket,        shortLabel: 'Pub' },
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
  const passed = report.passed;

  const sections = [
    { label: 'Lektionen', actual: report.lessons?.actual, expected: report.lessons?.expected, icon: BookOpen,
      detail: report.lessons?.duplicates > 0 ? `${report.lessons.duplicates} Duplikate` : null },
    { label: 'Prüfungsfragen', actual: report.exam?.total, expected: report.exam?.target, icon: ClipboardCheck,
      detail: report.exam?.approved ? `${report.exam.approved} freigegeben` : null },
    { label: 'Mündliche Szenarien', actual: report.oral?.total, expected: report.oral?.target, icon: MessageSquare },
    { label: 'Handbuch-Kapitel', actual: report.handbook?.chapters, expected: report.handbook?.target, icon: FileText,
      detail: report.handbook?.sections ? `${report.handbook.sections} Abschnitte` : null },
    { label: 'AI Tutor Index', actual: report.tutor_index ? 1 : 0, expected: 1, icon: Bot },
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
          return (
            <div key={s.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" /> {s.label}
                </span>
                <span className={cn("font-mono", ok ? "text-success" : "text-warning")}>
                  {s.actual ?? '?'}/{s.expected ?? '?'}
                  {s.detail && <span className="text-muted-foreground ml-1">({s.detail})</span>}
                </span>
              </div>
              <Progress value={pct} className="h-1" />
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
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke('export-course-package', {
        body: { packageId },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (error) throw error;
      toast.success('Export gestartet');
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
      <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeft className="h-4 w-4 mr-1" /> Kursliste
      </Button>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">{pkg.title || 'Kurspaket'}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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

      {/* ── Primary Actions ── */}
      <div className="flex flex-wrap gap-3">
        {!pkg.council_approved && councils.length === 0 && (
          <Button onClick={() => initCouncils.mutate()} disabled={initCouncils.isPending} size="sm">
            {initCouncils.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Brain className="h-4 w-4 mr-1" />}
            Councils einberufen
          </Button>
        )}
        {!pkg.council_approved && councils.length > 0 && (
          <Button onClick={() => approveCouncils.mutate()} disabled={approveCouncils.isPending} size="sm">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Council freigeben
          </Button>
        )}
        {pkg.council_approved && !isBuilding && pkg.status !== 'published' && (
          <Button onClick={() => startBuild.mutate()} disabled={startBuild.isPending} size="sm" variant="outline">
            {startBuild.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            Build starten
          </Button>
        )}
        {canPublish && (
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        )}
      </div>

      {/* ── Council Decisions ── */}
      {councils.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Council-Entscheidungen</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {councils.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <span className="text-sm">{c.council_type}</span>
                  <Badge variant="outline" className={cn("text-xs",
                    c.decision === 'approve' ? 'bg-success/10 text-success' :
                    c.decision === 'rejected' ? 'bg-destructive/10 text-destructive' :
                    'bg-warning/10 text-warning'
                  )}>
                    {c.decision || c.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
