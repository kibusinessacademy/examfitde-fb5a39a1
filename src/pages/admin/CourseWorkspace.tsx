import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCoursePackageDetail } from '@/hooks/useCoursePackages';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, ArrowLeft, CheckCircle2, XCircle, Clock, Play, Brain, Wrench, Shield, Download, ChevronRight, RefreshCw, AlertTriangle, Package, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STEPPER_STEPS = [
  { key: 'council', label: 'Council Plan', icon: Brain },
  { key: 'build', label: 'Build', icon: Wrench },
  { key: 'exam', label: 'Exam Trainer', icon: Shield },
  { key: 'oral', label: 'Oral Exam', icon: Play },
  { key: 'tutor', label: 'AI Tutor', icon: Brain },
  { key: 'handbook', label: 'Handbuch', icon: Package },
  { key: 'quality', label: 'Quality Gate', icon: Shield },
  { key: 'publish', label: 'Publish / Export', icon: Download },
];

const BUILD_STEP_MAP: Record<string, string> = {
  scaffold_learning_course: 'build',
  generate_exam_pool: 'exam',
  generate_oral_exam: 'oral',
  build_ai_tutor_index: 'tutor',
  generate_handbook: 'handbook',
  run_integrity_check: 'quality',
  auto_publish: 'publish',
};

function getStepperState(pkg: any, buildSteps: any[]) {
  const states: Record<string, 'done' | 'active' | 'failed' | 'pending'> = {};

  // Council
  states.council = pkg.council_approved ? 'done' : pkg.status === 'council_review' ? 'active' : 'pending';

  // Map build steps to stepper
  for (const step of buildSteps) {
    const stepperKey = BUILD_STEP_MAP[step.step_name];
    if (!stepperKey) continue;
    if (step.status === 'done') states[stepperKey] = 'done';
    else if (step.status === 'running') states[stepperKey] = 'active';
    else if (step.status === 'failed') states[stepperKey] = 'failed';
  }

  // Fill remaining
  for (const s of STEPPER_STEPS) {
    if (!states[s.key]) states[s.key] = 'pending';
  }

  return states;
}

export default function CourseWorkspace() {
  const { packageId } = useParams<{ packageId: string }>();
  const navigate = useNavigate();

  if (!packageId) {
    return <div className="p-8 text-center text-muted-foreground">Kein Paket ausgewählt.</div>;
  }

  return <WorkspaceContent packageId={packageId} onBack={() => navigate('/admin')} />;
}

function WorkspaceContent({ packageId, onBack }: { packageId: string; onBack: () => void }) {
  const {
    package: pkg,
    packageLoading,
    buildSteps,
    councils,
    startBuild,
    initCouncils,
    approveCouncils,
    invalidate,
  } = useCoursePackageDetail(packageId);

  const [resetting, setResetting] = useState(false);
  const [showDanger, setShowDanger] = useState(false);

  const handleReset = async () => {
    if (!confirm('⚠️ Gesamtes Kurspaket zurücksetzen? Alle Daten (Locks, Jobs, Lessons, Fragen, Tutor, Handbuch) werden gelöscht.')) return;
    setResetting(true);
    try {
      const { error } = await supabase.functions.invoke('course-reset', {
        body: { packageId },
      });
      if (error) throw error;
      toast.success('Paket wurde zurückgesetzt');
      invalidate();
    } catch (e: any) {
      toast.error(`Reset fehlgeschlagen: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  if (packageLoading || !pkg) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const stepperState = getStepperState(pkg, buildSteps);
  const statusLabel = pkg.status === 'published' ? 'Live' :
    pkg.status === 'building' ? 'Build läuft' :
    pkg.status === 'qa' ? 'QA' :
    pkg.status === 'failed' ? 'Fehlgeschlagen' :
    pkg.status === 'council_review' ? 'Council Review' : 'Draft';

  const statusColor = pkg.status === 'published' ? 'bg-success/20 text-success' :
    pkg.status === 'failed' ? 'bg-destructive/20 text-destructive' :
    pkg.status === 'building' ? 'bg-primary/20 text-primary' :
    'bg-muted text-muted-foreground';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1" /> Command Center
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">{pkg.title || 'Kurspaket'}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <Badge variant="outline" className={cn("text-xs", statusColor)}>{statusLabel}</Badge>
            {pkg.build_progress > 0 && pkg.build_progress < 100 && (
              <span className="text-xs text-muted-foreground">Build: {pkg.build_progress}%</span>
            )}
            {pkg.integrity_passed && (
              <span className="text-xs text-success flex items-center gap-1"><Shield className="h-3 w-3" /> Integrity OK</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => invalidate()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* Stepper */}
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
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                      state === 'done' ? 'bg-success text-success-foreground' :
                      state === 'active' ? 'bg-primary text-primary-foreground' :
                      state === 'failed' ? 'bg-destructive text-destructive-foreground' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> :
                       state === 'failed' ? <XCircle className="h-4 w-4" /> :
                       state === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                       <span>{i + 1}</span>}
                    </div>
                    <span className={cn(
                      "text-[10px] text-center leading-tight",
                      state === 'done' ? 'text-success font-medium' :
                      state === 'active' ? 'text-primary font-medium' :
                      state === 'failed' ? 'text-destructive font-medium' :
                      'text-muted-foreground'
                    )}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPPER_STEPS.length - 1 && (
                    <div className={cn(
                      "w-6 h-0.5 mt-4 shrink-0",
                      state === 'done' ? 'bg-success' : 'bg-border'
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
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
          <Button onClick={() => startBuild.mutate()} disabled={startBuild.isPending} size="sm">
            {startBuild.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            Build starten
          </Button>
        )}
        {pkg.status === 'published' && (
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/content/exports">
              <Download className="h-4 w-4 mr-1" /> Export
            </Link>
          </Button>
        )}
      </div>

      {/* Build Steps Detail */}
      {buildSteps.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Build-Schritte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {buildSteps.map((step: any) => {
                const isRunning = step.status === 'running';
                const isDone = step.status === 'done';
                const isFailed = step.status === 'failed';
                return (
                  <div key={step.id || step.step_name} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {isDone ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> :
                       isFailed ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> :
                       isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> :
                       <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <span className="text-sm truncate">{step.step_name}</span>
                    </div>
                    <Badge variant="outline" className={cn("text-xs shrink-0",
                      isDone ? 'bg-success/10 text-success' :
                      isFailed ? 'bg-destructive/10 text-destructive' :
                      isRunning ? 'bg-primary/10 text-primary' :
                      ''
                    )}>
                      {step.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Council Decisions */}
      {councils.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Council-Entscheidungen</CardTitle>
          </CardHeader>
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

      {/* Danger Zone */}
      <div className="pt-4">
        <button
          onClick={() => setShowDanger(!showDanger)}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          {showDanger ? '▼' : '▶'} Danger Zone
        </button>
        {showDanger && (
          <Card className="mt-3 border-destructive/30">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-destructive">Kurspaket vollständig zurücksetzen</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Löscht: Locks, Jobs, Lessons, Exam Questions, Tutor Index, Handbook, Package Steps.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReset}
                  disabled={resetting}
                >
                  {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
