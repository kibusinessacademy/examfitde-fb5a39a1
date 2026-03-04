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
  Loader2, ArrowLeft, CheckCircle2, XCircle, Clock,
  RefreshCw, Download, RotateCcw, Rocket, Activity,
  Unlock, AlertTriangle, Lightbulb, Zap, StopCircle, ChevronDown, ChevronRight, ShieldCheck
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
import { useTrackConfig } from '@/hooks/useTrackConfig';
import IntegrityReportCard from './workspace/IntegrityReportCard';
import AutoGapCloserPanel from './workspace/AutoGapCloserPanel';
import ExportTab from './workspace/ExportTab';
import { ALL_PIPELINE_STEPS, diagnoseError } from './workspace/workspaceConfig';

export default function CourseWorkspace() {
  const { packageId } = useParams<{ packageId: string }>();
  const navigate = useNavigate();
  if (!packageId) return <div className="p-8 text-center text-muted-foreground">Kein Paket ausgewählt.</div>;
  return <WorkspaceContent packageId={packageId} onBack={() => navigate('/admin/courses')} />;
}

function WorkspaceContent({ packageId, onBack }: { packageId: string; onBack: () => void }) {
  const { setCourseId, refresh: refreshContext } = useActiveCourse();
  const { package: pkg, packageLoading, buildSteps, councils, startBuild, initCouncils, approveCouncils, invalidate } = useCoursePackageDetail(packageId);
  const { track, certType, flags } = useTrackConfig(pkg as any);
  const PIPELINE_STEPS = ALL_PIPELINE_STEPS.filter(s => s.flag === null || (flags as any)[s.flag] === true);

  const [resetting, setResetting] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [rebuildingStep, setRebuildingStep] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    if (pkg?.status !== 'building') return;
    const interval = setInterval(() => invalidate(), 8000);
    return () => clearInterval(interval);
  }, [pkg?.status, invalidate]);

  useEffect(() => { setCourseId(packageId); return () => setCourseId(null); }, [packageId, setCourseId]);

  const refreshAll = useCallback(() => { invalidate(); refreshContext(); }, [invalidate, refreshContext]);

  const handleFullPipeline = async () => {
    setPipelineRunning(true);
    try {
      if (councils.length === 0) { await initCouncils.mutateAsync(); toast.info('Councils einberufen...'); }
      // Council approval is NOT auto-granted — it requires actual completed council sessions
      await startBuild.mutateAsync();
      toast.success('Pipeline gestartet – Build läuft automatisch');
      refreshAll();
    } catch (e: any) { toast.error(`Pipeline-Fehler: ${e.message}`); }
    finally { setPipelineRunning(false); }
  };

  const handleRebuildStep = async (stepKey: string) => {
    setRebuildingStep(stepKey);
    try {
      await (supabase as any).from('package_steps')
        .update({ status: 'queued', last_error: null, meta: null, started_at: null, finished_at: null, attempts: 0 })
        .eq('package_id', packageId).eq('step_key', stepKey);
      await (supabase as any).from('job_queue').insert({
        job_type: `package_${stepKey}`, status: 'pending', attempts: 0, max_attempts: 3, run_after: new Date().toISOString(),
        payload: { job_version: 'course_studio_v2', package_id: packageId, step_key: stepKey, course_id: pkg?.course_id, curriculum_id: (pkg as any)?.curriculum_id, certification_id: pkg?.certification_id },
      });
      toast.success(`Step "${stepKey}" wird erneut ausgeführt`);
      refreshAll();
    } catch (e: any) { toast.error(`Rebuild fehlgeschlagen: ${e.message}`); }
    finally { setRebuildingStep(null); }
  };

  const handleExceptionApprove = async (stepKey: string) => {
    const reason = prompt('Begründung für Ausnahme-Genehmigung:');
    if (!reason) return;
    setRebuildingStep(stepKey);
    try {
      await (supabase as any).from('package_steps')
        .update({
          status: 'done',
          exception_approved: true,
          exception_reason: reason,
          exception_approved_by: 'admin',
          exception_approved_at: new Date().toISOString(),
        })
        .eq('package_id', packageId)
        .eq('step_key', stepKey);
      toast.success(`Step "${stepKey}" als Ausnahme genehmigt`);
      refreshAll();
    } catch (e: any) { toast.error(`Ausnahme fehlgeschlagen: ${e.message}`); }
    finally { setRebuildingStep(null); }
  };

  const handleCancelPipeline = async () => {
    setCancelling(true);
    try {
      await (supabase as any).from('job_queue').update({ status: 'failed', error: 'Cancelled by admin', last_error: 'Cancelled by admin' }).like('payload->>package_id', packageId).in('status', ['pending', 'processing']);
      await (supabase as any).from('course_packages').update({ status: 'draft', build_progress: 0 }).eq('id', packageId);
      await (supabase as any).from('course_package_locks').delete().eq('package_id', packageId);
      toast.success('Pipeline abgebrochen'); refreshAll();
    } catch (e: any) { toast.error(`Abbruch fehlgeschlagen: ${e.message}`); }
    finally { setCancelling(false); }
  };

  const handleForceUnlock = async () => {
    try { await (supabase as any).from('course_package_locks').delete().eq('package_id', packageId); toast.success('Lock aufgehoben'); refreshAll(); }
    catch (e: any) { toast.error(`Unlock fehlgeschlagen: ${e.message}`); }
  };

  const handleReset = async () => {
    if (confirmReset < 1) { setConfirmReset(1); return; }
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke('course-reset', { body: { packageId }, headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      if (error) throw error;
      toast.success('Paket wurde vollständig zurückgesetzt'); setConfirmReset(0); refreshAll();
    } catch (e: any) { toast.error(`Reset fehlgeschlagen: ${e.message}`); }
    finally { setResetting(false); }
  };

  const handleExport = async () => {
    try {
      toast.info('Export wird erstellt…');
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('export-course-package', { body: { packageId }, headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      if (error) throw error;
      if (data?.downloadUrl) { window.open(data.downloadUrl, '_blank'); toast.success('Export bereit – Download gestartet'); }
      else toast.error('Keine Download-URL erhalten');
    } catch (e: any) { toast.error(`Export fehlgeschlagen: ${e.message}`); }
  };

  if (packageLoading || !pkg) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const stepMap = new Map<string, any>();
  for (const s of buildSteps) stepMap.set(s.step_key, s);
  const isStepCompleted = (s: any) => s?.status === 'done' || s?.status === 'skipped' || s?.exception_approved;
  const doneCount = buildSteps.filter(isStepCompleted).length;
  const totalCount = buildSteps.length || PIPELINE_STEPS.length;
  const failedSteps = buildSteps.filter((s: any) => s.status === 'failed');
  const runningStep = buildSteps.find((s: any) => s.status === 'running');
  const currentStepIdx = runningStep ? PIPELINE_STEPS.findIndex(s => s.key === runningStep.step_key) : failedSteps.length > 0 ? PIPELINE_STEPS.findIndex(s => s.key === failedSteps[0].step_key) : doneCount > 0 ? doneCount - 1 : -1;
  const healthScore = Math.max(0, Math.round((pkg.integrity_passed ? 30 : 0) + (pkg.council_approved ? 10 : 0) + (doneCount / Math.max(totalCount, 1) * 40) + (failedSteps.length === 0 ? 20 : Math.max(0, 20 - failedSteps.length * 5))));
  const canPublish = pkg.integrity_passed && pkg.council_approved && buildSteps.every((s: any) => s.status === 'done');
  const isBuilding = pkg.status === 'building';
  const progressPct = buildSteps.length > 0 ? Math.round((doneCount / Math.max(totalCount, 1)) * 100) : (pkg.build_progress || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0"><ArrowLeft className="h-4 w-4 mr-1" /> Kursliste</Button>
      </div>

      <PageExplainer
        title="Wie funktioniert der Course Workspace?"
        description="Der zentrale Arbeitsplatz für ein einzelnes Kurspaket. Hier steuerst du den gesamten Produktions-Workflow: Von der Council-Freigabe über den 17-Step-Build bis zur Veröffentlichung."
        workflow={[{ label: 'Curriculum' }, { label: 'Council' }, { label: '17-Step Build', active: true }, { label: 'Integrity' }, { label: 'Publish' }]}
        actions={[
          '"Pipeline starten" – Ein Klick startet: Council → Build (17 Steps) → Quality Gate → Auto-Publish',
          '"Build Pipeline" Tab – Visueller 17-Schritte-Stepper mit allen Generierungs- und Validierungsschritten',
          '"Produktmodule" Tab – Status aller 6 Module (Learning, Exam, Oral, Tutor, Handbook) mit Counts und Health',
          '"Council" Tab – Council-Diskussionen, Votes, Empfehlungen. Admin kann Approve/Reject überschreiben',
        ]}
        tips={[
          'Der Health Score (0-100%) berechnet sich aus: Integrity (30%), Council (10%), Build-Fortschritt (40%), Fehlerfreiheit (20%)',
          'Fehlerdiagnose: Jeder fehlgeschlagene Step zeigt Ursache + Lösungsvorschlag',
        ]}
      />

      {/* Elite Upgrade Warning */}
      {(() => {
        const ff = (pkg as any).feature_flags || {};
        const needsElite = 
          (pkg as any).track !== 'AUSBILDUNG_VOLL' ||
          !ff.has_learning_course ||
          !ff.has_minichecks ||
          !ff.has_handbook;
        if (!needsElite) return null;
        const handleUpgrade = async () => {
          setUpgrading(true);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('admin-ops', {
              body: { action: 'upgrade_to_elite', package_id: packageId },
              headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            });
            if (error) throw error;
            toast.success(`Elite-Upgrade: ${data?.steps_injected ?? data?.count ?? 0} Steps injiziert`);
            refreshAll();
          } catch (e: any) { toast.error(`Upgrade fehlgeschlagen: ${e.message}`); }
          finally { setUpgrading(false); }
        };
        return (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">
                  Didaktik fehlt — Track: {(pkg as any).track || 'unbekannt'} | Flags: 
                  {!ff.has_learning_course && ' ⚠️ Learning'}{!ff.has_minichecks && ' ⚠️ MiniChecks'}{!ff.has_handbook && ' ⚠️ Handbook'}
                </span>
              </div>
              <Button size="sm" variant="default" onClick={handleUpgrade} disabled={upgrading} className="shrink-0">
                {upgrading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                Upgrade to Elite
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">{pkg.title || 'Kurspaket'}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <TrackBadge track={track} certType={certType} showCertType />
            <Badge variant="outline" className={cn("text-xs", pkg.status === 'published' ? 'bg-success/20 text-success' : (pkg.status === 'failed' || pkg.status === 'quality_gate_failed') ? 'bg-destructive/20 text-destructive' : isBuilding ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
              {pkg.status === 'published' ? 'Live' : isBuilding ? 'Build läuft' : pkg.status === 'quality_gate_failed' ? 'QG Failed' : pkg.status === 'failed' ? 'Fehler' : pkg.status === 'qa' ? 'QA' : pkg.status === 'done' ? 'Done' : 'Draft'}
            </Badge>
            <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold", healthScore >= 95 ? 'bg-success/10 text-success' : healthScore >= 80 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
              <Activity className="h-3 w-3" /> {healthScore}%
            </div>
            {isBuilding && runningStep && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary">Step {currentStepIdx + 1}/{PIPELINE_STEPS.length}: {PIPELINE_STEPS[currentStepIdx]?.label || runningStep.step_key}</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isBuilding && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelPipeline} disabled={cancelling} className="text-destructive border-destructive/30">
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <StopCircle className="h-3.5 w-3.5 mr-1" />} Abbrechen
              </Button>
              <Button variant="outline" size="sm" onClick={handleForceUnlock} className="text-warning border-warning/30"><Unlock className="h-3.5 w-3.5 mr-1" /> Force Unlock</Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={refreshAll}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="build" className="space-y-4">
        <TabsList>
          <TabsTrigger value="build">Build Pipeline</TabsTrigger>
          <TabsTrigger value="modules">Produktmodule</TabsTrigger>
          <TabsTrigger value="council">Council</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="space-y-6">
          {/* Progress stepper */}
          {buildSteps.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-0 overflow-x-auto pb-3">
                  {PIPELINE_STEPS.map((step, i) => {
                    const buildStep = stepMap.get(step.key);
                    const status = buildStep?.status || 'pending';
                    const Icon = step.icon;
                    const isDone = status === 'done'; const isSkipped = status === 'skipped'; const isFailed = status === 'failed'; const isRunning = status === 'running';
                    return (
                      <div key={step.key} className="flex items-center shrink-0">
                        <div className="flex flex-col items-center gap-1 px-1.5 min-w-[56px]">
                          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-colors", isDone ? 'bg-success text-success-foreground' : isSkipped ? 'bg-muted-foreground/30 text-muted-foreground' : isRunning ? 'bg-primary text-primary-foreground' : isFailed ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}>
                            {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isSkipped ? <CheckCircle2 className="h-3.5 w-3.5 opacity-50" /> : isFailed ? <XCircle className="h-3.5 w-3.5" /> : isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                          </div>
                          <span className={cn("text-[9px] text-center leading-tight", isDone ? 'text-success font-medium' : isSkipped ? 'text-muted-foreground' : isRunning ? 'text-primary font-medium' : isFailed ? 'text-destructive font-medium' : 'text-muted-foreground')}>{step.shortLabel}</span>
                        </div>
                        {i < PIPELINE_STEPS.length - 1 && <div className={cn("w-4 h-0.5 shrink-0", (isDone || isSkipped) ? 'bg-success' : 'bg-border')} />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={progressPct} className="h-2 flex-1" />
                  <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{doneCount}/{totalCount} · {progressPct}%</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* One-click pipeline — hide for published, done, and quality_gate_failed */}
          {!['published', 'done', 'quality_gate_failed'].includes(pkg.status) && !isBuilding && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2"><Rocket className="h-4 w-4 text-primary" /> Kurs vollständig erstellen</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Council → 7 Build-Steps → Quality Gate → Auto-Publish</p>
                </div>
                <Button onClick={handleFullPipeline} disabled={pipelineRunning} size="sm">
                  {pipelineRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />} Pipeline starten
                </Button>
              </CardContent>
            </Card>
          )}

          {/* QG-Failed repair hint */}
          {pkg.status === 'quality_gate_failed' && !isBuilding && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Quality Gate nicht bestanden</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Prüfe den Integritätsbericht unten und behebe die Lücken über den Auto-Gap-Closer oder manuelle Schritte.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Auto-Gap-Closer */}
          {pkg.status !== 'published' && !isBuilding && pkg.integrity_report && !(pkg.integrity_report as any)?.passed && (
            <AutoGapCloserPanel packageId={packageId} courseId={pkg.course_id || ''} curriculumId={(pkg as any)?.curriculum_id || ''} integrityReport={pkg.integrity_report as any} onRefresh={refreshAll} />
          )}

          <BuildLiveLog packageId={packageId} isBuilding={isBuilding} />

          {pkg.integrity_report && typeof pkg.integrity_report === 'object' && (
            <IntegrityReportCard report={pkg.integrity_report} curriculumId={(pkg as any)?.curriculum_id} packageId={packageId} />
          )}

          {/* Error diagnostics */}
          {failedSteps.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> {failedSteps.length} fehlgeschlagene{failedSteps.length === 1 ? 'r' : ''} Schritt{failedSteps.length !== 1 ? 'e' : ''}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {failedSteps.map((step: any) => {
                  const diagnosis = diagnoseError(step.last_error || step.error_message);
                  const stepDef = PIPELINE_STEPS.find(s => s.key === (step.step_key || step.step_name));
                  return (
                    <div key={step.id || step.step_key} className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{stepDef?.label || step.step_label || step.step_key}</p>
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => handleRebuildStep(step.step_key || step.step_name)} disabled={rebuildingStep === (step.step_key || step.step_name)}>
                          {rebuildingStep === (step.step_key || step.step_name) ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />} Retry
                        </Button>
                      </div>
                      {(step.last_error || step.error_message) && <p className="text-xs text-destructive mt-1 font-mono truncate max-w-full">{step.last_error || step.error_message}</p>}
                      {diagnosis && (
                        <div className="mt-2 flex items-start gap-2 bg-warning/5 border border-warning/20 rounded p-2">
                          <Lightbulb className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                          <div className="text-xs"><p className="text-foreground"><strong>Ursache:</strong> {diagnosis.cause}</p><p className="text-muted-foreground"><strong>Lösung:</strong> {diagnosis.fix}</p></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Build steps detail */}
          {buildSteps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Build-Schritte</span>
                  <span className="text-xs font-normal text-muted-foreground">{isBuilding && '⟳ Auto-Refresh alle 8s'}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {PIPELINE_STEPS.map((stepDef, idx) => {
                    const step = stepMap.get(stepDef.key);
                    const status = step?.status || 'queued';
                    const isDone = status === 'done'; const isSkipped = status === 'skipped'; const isFailed = status === 'failed'; const isRunning = status === 'running';
                    const isException = step?.exception_approved === true;
                    const stepKey = stepDef.key;
                    const isExpanded = expandedStep === stepKey;
                    const hasDetails = step?.meta || step?.log || step?.last_error || step?.error_message || isException;
                    const Icon = stepDef.icon;
                    return (
                      <div key={stepKey} className={cn("border rounded-lg transition-colors", isRunning ? "border-primary/40 bg-primary/5" : isException ? "border-success/40" : "border-border/30")}>
                        <button className="w-full flex items-center justify-between gap-3 py-2.5 px-3 text-left hover:bg-muted/30 rounded-lg transition-colors" onClick={() => setExpandedStep(isExpanded ? null : stepKey)}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] text-muted-foreground w-4 text-center">{idx + 1}</span>
                            {isException ? <ShieldCheck className="h-4 w-4 text-success shrink-0" /> : isDone ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : isFailed ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> : isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> : <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <span className="text-sm truncate block">{stepDef.label}</span>
                              <span className="text-[9px] text-muted-foreground/60 font-mono block">{stepKey}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!isDone && !isRunning && !isBuilding && (
                              <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-warning" onClick={(e) => { e.stopPropagation(); handleExceptionApprove(stepKey); }} disabled={rebuildingStep === stepKey}>
                                <ShieldCheck className="h-3 w-3 mr-0.5" /> Ausnahme
                              </Button>
                            )}
                            {(isDone || isFailed) && !isBuilding && (
                              <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); handleRebuildStep(stepKey); }} disabled={rebuildingStep === stepKey}>
                                <RotateCcw className="h-3 w-3 mr-0.5" /> Retry
                              </Button>
                            )}
                            {isException && <Badge variant="outline" className="text-[10px] bg-success/10 text-success">Genehmigt</Badge>}
                            <Badge variant="outline" className={cn("text-[10px]", isDone ? 'bg-success/10 text-success' : isSkipped ? 'bg-muted text-muted-foreground' : isFailed ? 'bg-destructive/10 text-destructive' : isRunning ? 'bg-primary/10 text-primary' : '')}>{status}</Badge>
                            {hasDetails && (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                          </div>
                        </button>
                        {isExpanded && hasDetails && (
                        <div className="px-3 pb-3 pt-0 space-y-2">
                            {isException && (
                              <div className="bg-success/5 border border-success/20 rounded p-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                                  <span className="text-[10px] font-medium text-success uppercase tracking-wider">Ausnahme genehmigt</span>
                                </div>
                                <p className="text-xs text-muted-foreground">{step?.exception_reason}</p>
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  von {step?.exception_approved_by} am {step?.exception_approved_at ? new Date(step.exception_approved_at).toLocaleString('de-DE') : '–'}
                                </p>
                              </div>
                            )}
                            {(step?.last_error || step?.error_message) && <p className="text-xs text-destructive bg-destructive/5 p-2 rounded font-mono break-all">{step.last_error || step.error_message}</p>}
                            {(() => {
                              const logData = step?.meta || step?.log;
                              if (!logData || Object.keys(logData).length === 0) return null;
                              return (
                                <div className="bg-muted/30 p-2 rounded space-y-1">
                                  {Object.entries(logData as Record<string, unknown>).filter(([k]) => k !== 'ok' && k !== 'note' && k !== 'batch_complete').map(([key, val]) => (
                                    <div key={key} className="flex items-center justify-between text-[11px]">
                                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                                      <span className="font-mono text-foreground">{typeof val === 'boolean' ? (val ? '✅' : '❌') : typeof val === 'number' ? val.toLocaleString('de-DE') : typeof val === 'string' ? val : JSON.stringify(val)}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {(pkg.status === 'published' || canPublish) && (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" /> Export</Button>
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

      {/* Danger Zone */}
      <div className="pt-4">
        <button onClick={() => { setShowDanger(!showDanger); setConfirmReset(0); }} className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1">
          {showDanger ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Danger Zone
        </button>
        {showDanger && (
          <Card className="mt-3 border-destructive/30">
            <CardContent className="py-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-destructive">Kurspaket vollständig zurücksetzen</p>
                <p className="text-xs text-muted-foreground mt-1">Löscht: Locks, Jobs, Lessons, Modules, Exam Questions, Tutor Index, Handbook, Package Steps.</p>
              </div>
              {confirmReset === 0 && (
                <Button variant="destructive" size="sm" onClick={handleReset}><RotateCcw className="h-4 w-4 mr-1" /> Reset anfordern</Button>
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
                      {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />} Endgültig löschen
                    </Button>
                  </div>
                </div>
              )}
              <FeatureFlagEditor flags={flags} track={track} onChange={() => {}} onSave={refreshAll} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
