import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePackageEffectiveState } from '@/hooks/usePackageEffectiveState';
import { useParams, useNavigate } from 'react-router-dom';
import { useCoursePackageDetail } from '@/hooks/useCoursePackages';
import { useActiveCourse } from '@/contexts/ActiveCourseContext';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Loader2, ArrowLeft, CheckCircle2, XCircle, Clock,
  RefreshCw, Download, RotateCcw, Rocket, Activity,
  Unlock, AlertTriangle, Lightbulb, Zap, StopCircle, ChevronDown, ChevronRight, ShieldCheck,
  TrendingDown, Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  retryPackageStep as retryStepAction,
  cancelPackageBuild as cancelBuildAction,
  forceUnlockPackage as forceUnlockAction,
  approveStepException as approveExceptionAction,
  resetToStep as resetToStepAction,
  enqueueSingleStep as enqueueSingleStepAction,
} from '@/integrations/supabase/admin-ops-actions';
import BuildLiveLog from '@/components/admin/BuildLiveLog';
import ProductModuleStatus from '@/components/admin/ProductModuleStatus';
import CouncilTimeline from '@/components/admin/CouncilTimeline';
import PageExplainer from '@/components/admin/PageExplainer';
import TrackBadge from '@/components/admin/TrackBadge';
import FeatureFlagEditor from '@/components/admin/FeatureFlagEditor';
import { useTrackConfig } from '@/hooks/useTrackConfig';
import IntegrityReportCard from '@/components/admin/studio/IntegrityReportCard';
import AutoGapCloserPanel from '@/components/admin/studio/AutoGapCloserPanel';
import ExportTab from '@/components/admin/studio/ExportTab';
import { ALL_PIPELINE_STEPS, diagnoseError } from '@/components/admin/studio/workspaceConfig';
import type { PipelineStepUI } from '@/lib/pipeline-ui-registry';
import { getActivePipelineStepsUI } from '@/lib/pipeline-ui-registry';
import { useQuery } from '@tanstack/react-query';

export default function CourseWorkspace() {
  const { packageId } = useParams<{ packageId: string }>();
  const navigate = useNavigate();
  if (!packageId) return <div className="p-8 text-center text-muted-foreground">Kein Paket ausgewählt.</div>;
  return <WorkspaceContent packageId={packageId} onBack={() => navigate('/admin/studio')} />;
}

function WorkspaceContent({ packageId, onBack }: { packageId: string; onBack: () => void }) {
  const { setCourseId, refresh: refreshContext } = useActiveCourse();
  const { package: pkg, packageLoading, buildSteps, activeJobs, councils, startBuild, initCouncils, approveCouncils, invalidate } = useCoursePackageDetail(packageId);
  const { track, certType, flags } = useTrackConfig(pkg as any);
  const PIPELINE_STEPS = getActivePipelineStepsUI(flags as unknown as Record<string, boolean>);

  // SSOT data from canonical view
  const { data: allSsot } = useAdminPackagesSSOT();
  const ssot = useMemo(() => allSsot?.find(p => p.package_id === packageId) ?? null, [allSsot, packageId]);

  // Real-time content progress from lessons table
  const contentProgressQuery = useQuery({
    queryKey: ['content-progress', packageId],
    queryFn: async () => {
      const { data: pkgData } = await supabase.from('course_packages').select('course_id').eq('id', packageId).single();
      if (!pkgData?.course_id) return null;
      const { data } = await (supabase as any).rpc('get_package_content_progress', { p_package_id: packageId });
      if (data) return data as { total_lessons: number; content_done: number; tier1_failed: number; placeholder: number; regenerating: number; exam_questions: number; oral_scenarios: number; handbook_chapters: number };
      // Fallback: direct query
      const { data: lessons } = await (supabase as any)
        .from('lessons')
        .select('content, qc_status, step')
        .in('module_id', (await (supabase as any).from('modules').select('id').eq('course_id', pkgData.course_id)).data?.map((m: any) => m.id) || []);
      const ls = lessons || [];
      return {
        total_lessons: ls.filter((l: any) => l.step !== 'mini_check').length,
        content_done: ls.filter((l: any) => l.step !== 'mini_check' && l.content && l.content?._placeholder !== 'true' && l.qc_status !== 'tier1_failed').length,
        tier1_failed: ls.filter((l: any) => l.step !== 'mini_check' && l.qc_status === 'tier1_failed').length,
        placeholder: ls.filter((l: any) => l.step !== 'mini_check' && (!l.content || l.content?._placeholder === 'true')).length,
        regenerating: ls.filter((l: any) => l.step !== 'mini_check' && l.content?._regenerating === 'true').length,
        exam_questions: 0, oral_scenarios: 0, handbook_chapters: 0,
      };
    },
    enabled: !!packageId && pkg?.status === 'building',
    refetchInterval: pkg?.status === 'building' ? 10000 : false,
  });

  const [resetting, setResetting] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [rebuildingStep, setRebuildingStep] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [selectedResetStep, setSelectedResetStep] = useState('');
  const [manualActionLoading, setManualActionLoading] = useState(false);

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
      await retryStepAction(packageId, stepKey);
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
      await approveExceptionAction(packageId, stepKey, reason);
      toast.success(`Step "${stepKey}" als Ausnahme genehmigt`);
      refreshAll();
    } catch (e: any) { toast.error(`Ausnahme fehlgeschlagen: ${e.message}`); }
    finally { setRebuildingStep(null); }
  };

  const handleCancelPipeline = async () => {
    setCancelling(true);
    try {
      await cancelBuildAction(packageId);
      toast.success('Pipeline abgebrochen'); refreshAll();
    } catch (e: any) { toast.error(`Abbruch fehlgeschlagen: ${e.message}`); }
    finally { setCancelling(false); }
  };

  const handleForceUnlock = async () => {
    try { await forceUnlockAction(packageId); toast.success('Lock aufgehoben'); refreshAll(); }
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

  // Build reverse map: jobType → stepKey from active jobs
  // Derive which steps have active (processing) jobs
  const stepsWithProcessingJobs = new Set<string>();
  for (const job of activeJobs) {
    // Convention: most job types are `package_{step_key}`, handle known exceptions
    const stepKey = job.job_type
      .replace(/^package_/, '')
      .replace(/^lesson_generate_content.*/, 'generate_learning_content')
      .replace(/^lesson_generate_competency_bundle/, 'generate_learning_content')
      .replace(/^handbook_expand_section/, 'expand_handbook');
    if (job.status === 'processing') {
      stepsWithProcessingJobs.add(stepKey);
    }
  }

  // Helper: derive effective display status (step status + job status)
  const getEffectiveStatus = (stepKey: string, rawStatus: string) => {
    if (rawStatus === 'done' || rawStatus === 'skipped' || rawStatus === 'failed') return rawStatus;
    // If step is queued/enqueued/pending but has a processing job → effectively running
    if (stepsWithProcessingJobs.has(stepKey) && rawStatus !== 'running') return 'running';
    return rawStatus;
  };

  // SSOT-aligned: denominator = functional steps (excludes skipped), numerator = done only
  const functionalSteps = buildSteps.filter((s: any) => s?.status !== 'skipped');
  const doneCount = buildSteps.filter((s: any) => s?.status === 'done').length;
  const totalCount = functionalSteps.length || PIPELINE_STEPS.length;
  const failedSteps = buildSteps.filter((s: any) => s.status === 'failed');
  const runningStep = buildSteps.find((s: any) => s.status === 'running' || stepsWithProcessingJobs.has(s.step_key));
  const currentStepIdx = runningStep ? PIPELINE_STEPS.findIndex(s => s.key === runningStep.step_key) : failedSteps.length > 0 ? PIPELINE_STEPS.findIndex(s => s.key === failedSteps[0].step_key) : doneCount > 0 ? doneCount - 1 : -1;
  // SSOT-first: derive health and publish readiness from canonical view, not step history
  const councilComplete = ssot?.council_complete ?? false;
  const councilApproved = ssot?.council_approved ?? pkg.council_approved ?? false;
  const integrityPassed = ssot?.integrity_passed ?? pkg.integrity_passed ?? false;
  const hasStalePublish = ssot?.has_stale_publish ?? false;
  const hasPublishDrift = ssot?.has_publish_drift ?? false;
  const isStuck = ssot?.is_stuck ?? false;

  const releaseState = pkg.status === 'published' && !hasPublishDrift
    ? 'published'
    : pkg.status === 'published' && hasPublishDrift
    ? 'publish_drift'
    : pkg.status === 'council_review'
    ? 'council_review'
    : integrityPassed && councilApproved
    ? 'ready_to_publish'
    : pkg.status === 'building'
    ? 'building'
    : 'blocked';

  const healthScore = Math.max(0, Math.round(
    (integrityPassed ? 30 : 0) +
    (councilApproved ? 15 : councilComplete ? 5 : 0) +
    (doneCount / Math.max(totalCount, 1) * 35) +
    (failedSteps.length === 0 ? 20 : Math.max(0, 20 - failedSteps.length * 5)) +
    (hasStalePublish ? -10 : 0) +
    (hasPublishDrift ? -15 : 0)
  ));
  const canPublish = integrityPassed && councilApproved && !hasPublishDrift && functionalSteps.every((s: any) => s.status === 'done');
  const isBuilding = pkg.status === 'building';
  const progressPct = buildSteps.length > 0 ? Math.round((doneCount / Math.max(totalCount, 1)) * 100) : (pkg.build_progress || 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0"><ArrowLeft className="h-4 w-4 mr-1" /> Kursliste</Button>
      </div>

      {/* SSOT Drift Warnings */}
      {hasStalePublish && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">Stale-Publish-Signal erkannt</div>
            <div className="text-xs text-muted-foreground">Historisches published_at gesetzt, aber Paket ist aktuell nicht veröffentlicht.</div>
          </div>
        </div>
      )}
      {hasPublishDrift && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
          <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">Publish Drift</div>
            <div className="text-xs text-muted-foreground">Status ist „published", aber Publish-Gate inhaltlich nicht bestanden.</div>
          </div>
        </div>
      )}
      {isStuck && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">Paket festgefahren</div>
            <div className="text-xs text-muted-foreground">Kein Fortschritt seit über 30 Minuten (alle Aktivitätsquellen geprüft).</div>
          </div>
        </div>
      )}

      {/* ── Workspace Header Card ─────────────────────────── */}
      <Card className="border-border/50">
        <CardContent className="py-4 px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-display font-bold text-foreground truncate">{pkg.title || 'Kurspaket'}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <TrackBadge track={track} certType={certType} showCertType />
                <Badge variant="outline" className={cn("text-xs",
                  releaseState === 'published' ? 'bg-success/20 text-success' :
                  releaseState === 'publish_drift' ? 'bg-destructive/20 text-destructive' :
                  releaseState === 'council_review' ? 'bg-warning/20 text-warning' :
                  releaseState === 'building' ? 'bg-primary/20 text-primary' :
                  releaseState === 'ready_to_publish' ? 'bg-success/20 text-success' :
                  'bg-muted text-muted-foreground'
                )}>
                  {releaseState === 'published' ? 'Live' :
                   releaseState === 'publish_drift' ? 'Publish Drift' :
                   releaseState === 'council_review' ? 'Council Review' :
                   releaseState === 'building' ? 'Build läuft' :
                   releaseState === 'ready_to_publish' ? 'Bereit' :
                   pkg.status}
                </Badge>
                <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold", healthScore >= 95 ? 'bg-success/10 text-success' : healthScore >= 80 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
                  <Activity className="h-3 w-3" /> {healthScore}%
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isBuilding && (
                <>
                  <Button variant="outline" size="sm" onClick={handleCancelPipeline} disabled={cancelling} className="text-destructive border-destructive/30">
                    {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <StopCircle className="h-3.5 w-3.5 mr-1" />} <span className="hidden sm:inline">Abbrechen</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleForceUnlock} className="text-warning border-warning/30"><Unlock className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Unlock</span></Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={refreshAll}><RefreshCw className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Aktualisieren</span></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── SSOT Freigabe-Status ─────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className={cn("border-border/40", councilComplete ? 'border-success/30' : ssot && ssot.council_sessions_pending > 0 ? 'border-warning/30' : '')}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1"><Shield className="h-3 w-3" /> Council</p>
            <p className={cn("text-xl font-bold mt-0.5", councilComplete && councilApproved ? 'text-success' : councilComplete ? 'text-warning' : 'text-foreground')}>
              {councilComplete && councilApproved ? '✓ Approved' : councilComplete ? '✓ Fertig' : ssot ? `${ssot.council_sessions_completed}/${ssot.council_sessions_total}` : '–'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {ssot && ssot.council_sessions_pending > 0 ? `${ssot.council_sessions_pending} pending` : councilComplete && !councilApproved ? 'Warte auf Approval' : councilApproved ? 'Freigegeben' : 'Sessions'}
            </p>
          </CardContent>
        </Card>
        <Card className={cn("border-border/40", integrityPassed ? 'border-success/30' : '')}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Integrität</p>
            <p className={cn("text-xl font-bold mt-0.5", integrityPassed ? 'text-success' : 'text-muted-foreground')}>{integrityPassed ? '✓ Bestanden' : '✗ Offen'}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{integrityPassed ? 'Quality Gate OK' : 'Noch nicht bestanden'}</p>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fragen</p>
            <p className={cn("text-xl font-bold mt-0.5", ssot && ssot.approved_questions >= 100 ? 'text-success' : 'text-foreground')}>
              {ssot ? `${ssot.approved_questions}` : '–'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">{ssot ? `von ${ssot.total_questions} total · ${ssot.approved_questions >= 100 ? '✓' : '✗'} Gate (≥100)` : 'Approved'}</p>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Build-Historie</p>
            <p className="text-xl font-bold text-foreground mt-0.5">{progressPct}%</p>
            <Progress value={progressPct} className="h-1 mt-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">{doneCount}/{totalCount} Steps (historisch)</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs — horizontal scrollable on mobile */}
      <Tabs defaultValue="build" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="build">Build Pipeline</TabsTrigger>
            <TabsTrigger value="modules">Produktmodule</TabsTrigger>
            <TabsTrigger value="council">Council</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="build" className="space-y-6">
          {/* Progress stepper — Build-Historie, nicht aktueller Freigabestatus */}
          {buildSteps.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">Build-Historie (nicht Freigabestatus)</p>
                <div className="flex items-center gap-0 overflow-x-auto pb-3">
                  {PIPELINE_STEPS.map((step, i) => {
                    const buildStep = stepMap.get(step.key);
                    const rawStatus = buildStep?.status || 'pending';
                    const status = getEffectiveStatus(step.key, rawStatus);
                    const Icon = step.icon;
                    const isDone = status === 'done'; const isSkipped = status === 'skipped'; const isFailed = status === 'failed'; const isRunning = status === 'running';
                    // Integrity step done but not passed = warning state
                    const isIntegrityWarning = step.key === 'run_integrity_check' && isDone && !integrityPassed;
                    const isBlocked = status === 'blocked';
                    return (
                      <div key={step.key} className="flex items-center shrink-0">
                        <div className="flex flex-col items-center gap-1 px-1.5 min-w-[56px]">
                          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-colors", isIntegrityWarning ? 'bg-warning text-warning-foreground' : isBlocked ? 'bg-destructive/60 text-destructive-foreground' : isDone ? 'bg-success text-success-foreground' : isSkipped ? 'bg-muted-foreground/30 text-muted-foreground' : isRunning ? 'bg-primary text-primary-foreground' : isFailed ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}>
                            {isIntegrityWarning ? <AlertTriangle className="h-3.5 w-3.5" /> : isBlocked ? <XCircle className="h-3.5 w-3.5" /> : isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isSkipped ? <CheckCircle2 className="h-3.5 w-3.5 opacity-50" /> : isFailed ? <XCircle className="h-3.5 w-3.5" /> : isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                          </div>
                          <span className={cn("text-[9px] text-center leading-tight", isIntegrityWarning ? 'text-warning font-medium' : isBlocked ? 'text-destructive font-medium' : isDone ? 'text-success font-medium' : isSkipped ? 'text-muted-foreground' : isRunning ? 'text-primary font-medium' : isFailed ? 'text-destructive font-medium' : 'text-muted-foreground')}>{step.shortLabel}</span>
                        </div>
                        {i < PIPELINE_STEPS.length - 1 && <div className={cn("w-4 h-0.5 shrink-0", (isDone && !isIntegrityWarning || isSkipped) ? 'bg-success' : isIntegrityWarning ? 'bg-warning' : 'bg-border')} />}
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

          {/* Content Progress Card - shows actual data from lessons table */}
          {isBuilding && contentProgressQuery.data && (
            <Card className="border-border/50">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">Inhalts-Fortschritt (Live)</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {contentProgressQuery.data.content_done}/{contentProgressQuery.data.total_lessons} Lektionen
                  </span>
                </div>
                <Progress 
                  value={contentProgressQuery.data.total_lessons > 0 
                    ? Math.round(contentProgressQuery.data.content_done / contentProgressQuery.data.total_lessons * 100) 
                    : 0} 
                  className="h-1.5 mb-2" 
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    {contentProgressQuery.data.content_done} fertig
                  </span>
                  {contentProgressQuery.data.tier1_failed > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                      {contentProgressQuery.data.tier1_failed} QC fehlgeschlagen
                    </span>
                  )}
                  {contentProgressQuery.data.placeholder > 0 && (
                    <span className="flex items-center gap-1 text-warning">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                      {contentProgressQuery.data.placeholder} ausstehend
                    </span>
                  )}
                  {contentProgressQuery.data.regenerating > 0 && (
                    <span className="flex items-center gap-1 text-primary">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      {contentProgressQuery.data.regenerating} regenerierend
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Unblock button for blocked packages */}
          {pkg.status === 'blocked' && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2"><Unlock className="h-4 w-4 text-destructive" /> Kurs ist blockiert</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(pkg as any).blocked_reason ? `Grund: ${(pkg as any).blocked_reason}` : 'Paket entblockieren und Pipeline fortsetzen'}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pipelineRunning}
                  onClick={async () => {
                    setPipelineRunning(true);
                    try {
                      await runAdminOpsAction('unblock_package', { package_id: packageId, reason: 'Admin-Unblock via CourseWorkspace' });
                      toast.success('Paket entblockiert – Pipeline wird fortgesetzt');
                      refreshAll();
                    } catch (e: any) { toast.error(`Entblockieren fehlgeschlagen: ${e.message}`); }
                    finally { setPipelineRunning(false); }
                  }}
                >
                  {pipelineRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Unlock className="h-4 w-4 mr-1" />} Entblockieren & Starten
                </Button>
              </CardContent>
            </Card>
          )}

          {!['published', 'done', 'quality_gate_failed', 'publish_failed', 'blocked'].includes(pkg.status) && !isBuilding && (
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

          {/* QG Banner — driven by SSOT effective state, not stale package.status */}
          <QualityGateBannerSSoT packageId={packageId} />

          {/* Auto-Gap-Closer — only show when effective state says autofix is allowed */}
          <AutoGapCloserSSoT packageId={packageId} courseId={pkg.course_id || ''} curriculumId={(pkg as any)?.curriculum_id || ''} integrityReport={pkg.integrity_report as any} onRefresh={refreshAll} isBuilding={isBuilding} />

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
                    const rawStatus = step?.status || 'queued';
                    const status = getEffectiveStatus(stepDef.key, rawStatus);
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
                            {!isDone && !isRunning && isBuilding && (
                              <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-warning" onClick={(e) => { e.stopPropagation(); handleExceptionApprove(stepKey); }} disabled={rebuildingStep === stepKey}>
                                <ShieldCheck className="h-3 w-3 mr-0.5" /> Ausnahme
                              </Button>
                            )}
                            {!isBuilding && pkg.status === 'queued' && !isDone && (
                              <span className="text-[10px] text-muted-foreground/70 italic">Wartet auf Slot</span>
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
          <ProductModuleStatus packageId={packageId} courseId={pkg.course_id || null} curriculumId={(pkg as any)?.curriculum_id || null} certificationId={pkg.certification_id || null} featureFlags={(pkg as any)?.feature_flags} />
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
              {/* Manual Step Controls */}
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Manuelles Step-Management</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={selectedResetStep} onChange={e => setSelectedResetStep(e.target.value)} className="text-xs border border-border rounded px-2 py-1.5 bg-background text-foreground flex-1">
                    <option value="">Step auswählen…</option>
                    {PIPELINE_STEPS.map(s => {
                      const bs = stepMap.get(s.key);
                      return <option key={s.key} value={s.key}>{s.label} ({bs?.status || 'pending'})</option>;
                    })}
                  </select>
                  <Button variant="outline" size="sm" disabled={!selectedResetStep || manualActionLoading} onClick={async () => {
                    setManualActionLoading(true);
                    try { await enqueueSingleStepAction(packageId, selectedResetStep); toast.success(`Step "${selectedResetStep}" enqueued`); refreshAll(); }
                    catch (e: any) { toast.error(e.message); }
                    finally { setManualActionLoading(false); }
                  }}>
                    {manualActionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />} Enqueue
                  </Button>
                  <Button variant="outline" size="sm" className="text-warning border-warning/30" disabled={!selectedResetStep || manualActionLoading} onClick={async () => {
                    if (!confirm(`Paket ab Step "${selectedResetStep}" zurücksetzen? Alle nachfolgenden Steps werden auf queued gesetzt.`)) return;
                    setManualActionLoading(true);
                    try { await resetToStepAction(packageId, selectedResetStep); toast.success(`Zurückgesetzt ab "${selectedResetStep}"`); refreshAll(); }
                    catch (e: any) { toast.error(e.message); }
                    finally { setManualActionLoading(false); }
                  }}>
                    {manualActionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />} Reset ab hier
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Enqueue: Triggert den gewählten Step-Job manuell. Reset: Setzt diesen und alle nachfolgenden Steps zurück.</p>
              </div>

              <div className="border-t border-border/30 pt-4">
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

// ── SSOT-driven QG Banner ──
function QualityGateBannerSSoT({ packageId }: { packageId: string }) {
  const { data: es } = usePackageEffectiveState(packageId);
  if (!es) return null;

  if (es.should_show_pass_banner && (es.package_status === 'quality_gate_failed' || es.package_status === 'publish_failed')) {
    // Integrity passed but status is stale — show green override
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="py-4">
          <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Quality Gate bestanden
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Integrity Score: 100 — Kompetenzabdeckung: {es.competencies_covered}/{es.competencies_total} ({Number(es.competency_coverage_pct).toFixed(0)}%)
          </p>
        </CardContent>
      </Card>
    );
  }

  if (es.should_show_fail_banner && es.package_status !== 'published') {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-4">
          <p className="text-sm font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Quality Gate nicht bestanden
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Prüfe den Integritätsbericht unten und behebe die Lücken über den Auto-Gap-Closer oder manuelle Schritte.
          </p>
        </CardContent>
      </Card>
    );
  }

  return null;
}

// ── SSOT-driven Auto-Gap-Closer visibility ──
function AutoGapCloserSSoT({ packageId, courseId, curriculumId, integrityReport, onRefresh, isBuilding }: {
  packageId: string; courseId: string; curriculumId: string; integrityReport: any; onRefresh: () => void; isBuilding: boolean;
}) {
  const { data: es } = usePackageEffectiveState(packageId);

  // Don't show if already passed, published, or building
  if (!es || es.effective_quality_gate_state === 'passed' || es.package_status === 'published' || isBuilding) {
    // Show "already passed" hint if integrity passed but page still shows
    if (es?.effective_quality_gate_state === 'passed' && es.package_status !== 'published') {
      return (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-3">
            <p className="text-xs text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Paket bereits bestanden — kein Autofix nötig
            </p>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  if (!integrityReport) return null;

  return <AutoGapCloserPanel packageId={packageId} courseId={courseId} curriculumId={curriculumId} integrityReport={integrityReport} onRefresh={onRefresh} />;
}
