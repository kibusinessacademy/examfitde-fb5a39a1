import { useState, useEffect } from 'react';
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
  Lock, Unlock, AlertTriangle, Lightbulb, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/* ───── stepper config ───── */
const STEPPER_STEPS = [
  { key: 'council',  label: 'Council Plan',    icon: Brain },
  { key: 'build',    label: 'Build',           icon: Wrench },
  { key: 'exam',     label: 'Exam Trainer',    icon: Shield },
  { key: 'oral',     label: 'Oral Exam',       icon: Play },
  { key: 'tutor',    label: 'AI Tutor',        icon: Brain },
  { key: 'handbook', label: 'Handbuch',        icon: FileText },
  { key: 'quality',  label: 'Quality Gate',    icon: Shield },
  { key: 'publish',  label: 'Publish / Export', icon: Download },
];

const BUILD_STEP_MAP: Record<string, string> = {
  scaffold_learning_course: 'build',
  generate_minichecks: 'build',
  generate_exam_pool: 'exam',
  build_exam_simulation: 'exam',
  generate_oral_exam: 'oral',
  build_ai_tutor_index: 'tutor',
  generate_handbook: 'handbook',
  run_integrity_check: 'quality',
  auto_publish: 'publish',
};

/* ───── error diagnosis ───── */
const ERROR_HINTS: Record<string, { cause: string; fix: string; action?: string }> = {
  INVALID_COMPETENCY_REF: { cause: 'Kompetenz-ID existiert nicht im Curriculum', fix: 'Lessons neu generieren', action: 'rebuild_lessons' },
  MISSING_COURSE_ID: { cause: 'Kurs-ID wurde nicht korrekt übergeben', fix: 'Build erneut starten', action: 'restart_build' },
  INTEGRITY_ERROR: { cause: 'Soll-Ist-Abgleich fehlgeschlagen', fix: 'Integrity Check erneut ausführen', action: 'rebuild_integrity' },
  DUPLICATE_LESSON: { cause: 'Doppelte Lektion erkannt', fix: 'Duplikate bereinigen lassen', action: 'fix_duplicates' },
  LLM_TIMEOUT: { cause: 'KI-Antwort Timeout', fix: 'Step erneut versuchen', action: 'retry' },
  MISSING_API_KEY: { cause: 'API-Key nicht konfiguriert', fix: 'API-Keys in den Einstellungen prüfen' },
};

function diagnoseError(errorMessage: string | null): { cause: string; fix: string; action?: string } | null {
  if (!errorMessage) return null;
  const upper = errorMessage.toUpperCase();
  for (const [key, hint] of Object.entries(ERROR_HINTS)) {
    if (upper.includes(key) || upper.includes(key.replace(/_/g, ' '))) return hint;
  }
  if (upper.includes('TIMEOUT') || upper.includes('TIMED OUT')) return ERROR_HINTS.LLM_TIMEOUT;
  if (upper.includes('API_KEY') || upper.includes('API KEY') || upper.includes('NOT CONFIGURED')) return ERROR_HINTS.MISSING_API_KEY;
  if (upper.includes('DUPLICATE') || upper.includes('UNIQUE')) return ERROR_HINTS.DUPLICATE_LESSON;
  return null;
}

type StepState = 'done' | 'active' | 'failed' | 'pending';

function getStepperState(pkg: any, buildSteps: any[]): Record<string, StepState> {
  const states: Record<string, StepState> = {};
  states.council = pkg.council_approved ? 'done' : pkg.status === 'council_review' ? 'active' : 'pending';
  for (const step of buildSteps) {
    const stepperKey = BUILD_STEP_MAP[step.step_key || step.step_name];
    if (!stepperKey) continue;
    const current = states[stepperKey];
    if (step.status === 'failed') states[stepperKey] = 'failed';
    else if (step.status === 'done' && current !== 'failed') states[stepperKey] = 'done';
    else if (step.status === 'running' && current !== 'failed' && current !== 'done') states[stepperKey] = 'active';
  }
  for (const s of STEPPER_STEPS) {
    if (!states[s.key]) states[s.key] = 'pending';
  }
  return states;
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

  // Set active course context
  useEffect(() => { setCourseId(packageId); return () => setCourseId(null); }, [packageId, setCourseId]);

  const refreshAll = () => { invalidate(); refreshContext(); };

  /* ── One-click pipeline ── */
  const handleFullPipeline = async () => {
    setPipelineRunning(true);
    try {
      // Step 1: Ensure councils exist
      if (councils.length === 0) {
        await initCouncils.mutateAsync();
        toast.info('Councils einberufen...');
      }
      // Step 2: Approve if not yet
      if (!pkg?.council_approved) {
        await approveCouncils.mutateAsync();
        toast.info('Council-Freigabe erteilt...');
      }
      // Step 3: Start build
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
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('build-course-package', {
        body: { packageId, rebuildStep: stepKey },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      toast.success(`Rebuild "${stepKey}" gestartet`);
      refreshAll();
    } catch (e: any) {
      toast.error(`Rebuild fehlgeschlagen: ${e.message}`);
    } finally {
      setRebuildingStep(null);
    }
  };

  /* ── Force unlock ── */
  const handleForceUnlock = async () => {
    try {
      const sb = supabase as any;
      await sb.from('course_package_locks').update({ released: true }).eq('package_id', packageId).eq('released', false);
      toast.success('Lock aufgehoben');
      refreshAll();
    } catch (e: any) {
      toast.error(`Unlock fehlgeschlagen: ${e.message}`);
    }
  };

  /* ── Safe reset (2-step confirm) ── */
  const handleReset = async () => {
    if (confirmReset < 1) {
      setConfirmReset(1);
      return;
    }
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

  const stepperState = getStepperState(pkg, buildSteps);
  const failedSteps = buildSteps.filter((s: any) => s.status === 'failed');
  const doneCount = buildSteps.filter((s: any) => s.status === 'done').length;
  const totalCount = buildSteps.length || 1;
  const healthScore = Math.max(0, Math.round(
    (pkg.integrity_passed ? 30 : 0) + (pkg.council_approved ? 10 : 0) +
    (doneCount / totalCount * 40) + (failedSteps.length === 0 ? 20 : Math.max(0, 20 - failedSteps.length * 5))
  ));
  const healthColor = healthScore >= 95 ? 'text-success' : healthScore >= 80 ? 'text-warning' : 'text-destructive';
  const canPublish = pkg.integrity_passed && pkg.council_approved && buildSteps.every((s: any) => s.status === 'done');
  const isLocked = pkg.status === 'building';

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
              pkg.status === 'building' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              {pkg.status === 'published' ? 'Live' : pkg.status === 'building' ? 'Build läuft' :
               pkg.status === 'failed' ? 'Fehler' : pkg.status === 'qa' ? 'QA' : 'Draft'}
            </Badge>
            <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
              healthScore >= 95 ? 'bg-success/10 text-success' : healthScore >= 80 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
            )}>
              <Activity className="h-3 w-3" /> {healthScore}%
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLocked && (
            <Button variant="outline" size="sm" onClick={handleForceUnlock} className="text-warning border-warning/30">
              <Unlock className="h-3.5 w-3.5 mr-1" /> Force Unlock
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* ── One-Click Pipeline ── */}
      {pkg.status !== 'published' && pkg.status !== 'building' && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" /> Kurs vollständig erstellen
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Prüft Council, startet Build, erstellt alle Komponenten automatisch.
              </p>
            </div>
            <Button onClick={handleFullPipeline} disabled={pipelineRunning || isLocked} size="sm">
              {pipelineRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              Pipeline starten
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Visual Stepper ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start gap-0 overflow-x-auto pb-2">
            {STEPPER_STEPS.map((step, i) => {
              const state = stepperState[step.key];
              const Icon = step.icon;
              return (
                <div key={step.key} className="flex items-center shrink-0">
                  <div className="flex flex-col items-center gap-1.5 px-2 min-w-[72px]">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                      state === 'done'   ? 'bg-success text-success-foreground' :
                      state === 'active'  ? 'bg-primary text-primary-foreground' :
                      state === 'failed'  ? 'bg-destructive text-destructive-foreground' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {state === 'done'   ? <CheckCircle2 className="h-4 w-4" /> :
                       state === 'failed' ? <XCircle className="h-4 w-4" /> :
                       state === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                       <span>{i + 1}</span>}
                    </div>
                    <span className={cn(
                      "text-[10px] text-center leading-tight",
                      state === 'done'   ? 'text-success font-medium' :
                      state === 'active' ? 'text-primary font-medium' :
                      state === 'failed' ? 'text-destructive font-medium' :
                      'text-muted-foreground'
                    )}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPPER_STEPS.length - 1 && (
                    <div className={cn("w-6 h-0.5 mt-4 shrink-0", state === 'done' ? 'bg-success' : 'bg-border')} />
                  )}
                </div>
              );
            })}
          </div>
          {buildSteps.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Progress value={(doneCount / totalCount) * 100} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground">{doneCount}/{totalCount}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Error Diagnostics ── */}
      {failedSteps.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {failedSteps.length} fehlgeschlagene Schritte
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failedSteps.map((step: any) => {
              const diagnosis = diagnoseError(step.error_message);
              return (
                <div key={step.id || step.step_key} className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{step.step_label || step.step_key}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => handleRebuildStep(step.step_key)}
                      disabled={rebuildingStep === step.step_key}
                    >
                      {rebuildingStep === step.step_key ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                      Neu versuchen
                    </Button>
                  </div>
                  {step.error_message && (
                    <p className="text-xs text-destructive mt-1 font-mono truncate">{step.error_message}</p>
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

      {/* ── Build Steps Detail ── */}
      {buildSteps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Build-Schritte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {buildSteps.map((step: any) => {
                const isDone = step.status === 'done';
                const isFailed = step.status === 'failed';
                const isRunning = step.status === 'running';
                const stepKey = step.id || step.step_key;
                const isExpanded = expandedStep === stepKey;
                const hasDetails = step.log || step.error_message;

                return (
                  <div key={stepKey} className="border border-border/30 rounded-lg">
                    <button
                      className="w-full flex items-center justify-between gap-3 py-2.5 px-3 text-left hover:bg-muted/30 rounded-lg transition-colors"
                      onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isDone ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> :
                         isFailed ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> :
                         isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> :
                         <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="text-sm truncate">{step.step_label || step.step_key}</span>
                        {step.duration_ms && (
                          <span className="text-[10px] text-muted-foreground">({(step.duration_ms / 1000).toFixed(1)}s)</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isDone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={(e) => { e.stopPropagation(); handleRebuildStep(step.step_key); }}
                            disabled={rebuildingStep === step.step_key}
                          >
                            <RotateCcw className="h-3 w-3 mr-0.5" /> Rebuild
                          </Button>
                        )}
                        <Badge variant="outline" className={cn("text-xs",
                          isDone ? 'bg-success/10 text-success' :
                          isFailed ? 'bg-destructive/10 text-destructive' :
                          isRunning ? 'bg-primary/10 text-primary' : ''
                        )}>
                          {step.status}
                        </Badge>
                        {hasDetails && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                      </div>
                    </button>
                    {isExpanded && hasDetails && (
                      <div className="px-3 pb-3 pt-0">
                        {step.error_message && (
                          <p className="text-xs text-destructive bg-destructive/5 p-2 rounded mb-2 font-mono">{step.error_message}</p>
                        )}
                        {step.log && Object.keys(step.log).length > 0 && (
                          <pre className="text-[10px] text-muted-foreground bg-muted/30 p-2 rounded overflow-x-auto max-h-40">
                            {JSON.stringify(step.log, null, 2)}
                          </pre>
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
        {pkg.council_approved && pkg.status !== 'building' && pkg.status !== 'published' && (
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
        <button
          onClick={() => { setShowDanger(!showDanger); setConfirmReset(0); }}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
        >
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
