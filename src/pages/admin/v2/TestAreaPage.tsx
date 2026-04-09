import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, ArrowLeft, Play, BookOpen, MessageSquare, Brain, Dices,
  Shield, Activity, Wrench, HeartPulse, RefreshCw
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useForensicMonitor, useForensicHeal } from '@/hooks/useForensicMonitor';
import { useIntegrityFailures } from '@/hooks/useIntegrityFailures';
import { usePublishReadiness } from '@/hooks/usePublishReadiness';
import { toast } from 'sonner';

const AdminAutoTestQueue = lazy(() =>
  import('@/features/admin/components/AdminAutoTestQueue').then(m => ({ default: m.AdminAutoTestQueue }))
);

type PreviewMode = 'standard' | 'premium' | 'adaptive';

function openLearnerView(curriculumId: string, path: string) {
  window.open(`${path}?curriculum=${curriculumId}&admin_preview=1`, '_blank');
}

/* ── Forensic Health Card ── */
function ForensicHealthCard() {
  const { data, isLoading, error, refetch } = useForensicMonitor();
  const healMutation = useForensicHeal();

  const handleHeal = () => {
    healMutation.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`Forensic Heal abgeschlossen — Health Score: ${result.health_score}`);
        refetch();
      },
      onError: (err) => toast.error(`Heal fehlgeschlagen: ${(err as Error).message}`),
    });
  };

  if (isLoading) return <Card><CardContent className="py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" /></CardContent></Card>;
  if (error || !data) return null;

  const severityColor = {
    P0: 'border-destructive/40 bg-destructive/5',
    P1: 'border-warning/40 bg-warning/5',
    P2: 'border-primary/20 bg-primary/5',
    info: 'border-border bg-card',
  }[data.severity] || 'border-border bg-card';

  return (
    <Card className={severityColor}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" />
            Pipeline Health Score
          </span>
          <div className="flex items-center gap-2">
            <Badge variant={data.severity === 'info' ? 'outline' : 'destructive'} className="text-[10px]">
              {data.severity}
            </Badge>
            <span className="text-lg font-bold">{data.health_score}%</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-5 gap-1.5 text-[10px]">
          {Object.entries(data.layers).map(([key, layer]) => (
            <div key={key} className={`rounded-lg border p-2 text-center ${layer.score >= 90 ? '' : layer.score >= 70 ? 'border-warning/30' : 'border-destructive/30'}`}>
              <div className="font-bold text-sm">{layer.score}</div>
              <div className="text-muted-foreground capitalize">{key}</div>
            </div>
          ))}
        </div>

        {data.heal_actions && data.heal_actions.length > 0 && (
          <div className="space-y-1">
            {data.heal_actions.map((action, i) => (
              <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <Wrench className="h-3 w-3 text-warning shrink-0" />
                <span>{action.action}: {action.detail} ({action.affected} betroffen)</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" /> Scan
          </Button>
          <Button size="sm" variant="default" className="text-xs h-7" onClick={handleHeal} disabled={healMutation.isPending}>
            {healMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <HeartPulse className="h-3 w-3 mr-1" />}
            Heal & Scan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Integrity Failures Card ── */
function IntegrityFailuresCard() {
  const { data, isLoading } = useIntegrityFailures();

  if (isLoading || !data || data.length === 0) return null;

  return (
    <Card className="border-destructive/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-destructive" />
          Integrity-Fehler ({data.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {data.slice(0, 8).map((item: any) => (
            <Link
              key={item.package_id}
              to={`/admin/studio?pkg=${item.package_id}`}
              className="flex items-center justify-between p-2 rounded-lg border border-border hover:bg-muted/30 transition-colors text-xs"
            >
              <span className="truncate font-medium">{item.title || item.package_id?.slice(0, 8)}</span>
              <Badge variant="outline" className="text-[9px] h-4 shrink-0">{item.status}</Badge>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Publish Readiness Summary Card ── */
function PublishReadinessCard() {
  const { data, isLoading } = usePublishReadiness();

  if (isLoading || !data) return null;

  const ready = data.filter((p: any) => p.publish_ready === true).length;
  const notReady = data.filter((p: any) => p.publish_ready === false).length;

  if (notReady === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Publish Readiness
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs">
            <span className="font-bold text-success">{ready}</span> bereit
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-1.5 text-xs">
            <span className="font-bold text-warning">{notReady}</span> nicht bereit
          </div>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {data.filter((p: any) => !p.publish_ready).slice(0, 6).map((item: any) => (
            <Link
              key={item.package_id}
              to={`/admin/studio?pkg=${item.package_id}`}
              className="flex items-center justify-between p-2 rounded-lg border border-border hover:bg-muted/30 transition-colors text-xs"
            >
              <span className="truncate font-medium">{item.title || item.package_id?.slice(0, 8)}</span>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{(item.reasons || []).slice(0, 2).join(', ')}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Run Autonomous Factory Button ── */
function FactoryTriggerButton() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-run-autonomous-factory', { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Factory-Run gestartet');
      qc.invalidateQueries({ queryKey: ['factory-executive'] });
      qc.invalidateQueries({ queryKey: ['admin-auto-test-queue'] });
    },
    onError: (err) => toast.error(`Factory-Fehler: ${(err as Error).message}`),
  });

  return (
    <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Dices className="h-3.5 w-3.5 mr-1.5" />}
      Factory starten
    </Button>
  );
}

/* ── Published Courses Quick Access ── */
function PublishedCourseList() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-published-courses-for-test'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_published_course_preview' as any)
        .select('*')
        .order('course_title');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-2">
      {data?.map((course: any) => (
        <div key={course.package_id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <div className="min-w-0 flex-1">
            <Link
              to={`/admin/studio?pkg=${course.package_id}`}
              className="text-sm font-medium truncate hover:text-primary transition-colors block"
            >
              {course.course_title}
            </Link>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[10px] h-4">{course.package_track || 'standard'}</Badge>
              <span className="text-[10px] text-muted-foreground">{course.approved_exam_questions} Fragen</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/exam-trainer')}>
              <Brain className="h-3.5 w-3.5 mr-1" /> Prüfung
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/oral-exam')}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Mündlich
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/shuttle')}>
              <Dices className="h-3.5 w-3.5 mr-1" /> Shuttle
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/handbuch')}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Handbuch
            </Button>
          </div>
        </div>
      ))}
      {(!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-4">Keine veröffentlichten Kurse gefunden.</p>
      )}
    </div>
  );
}

export default function TestAreaPage() {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('standard');

  return (
    <div className="space-y-6">
      {/* Header with navigation */}
      <div>
        <Link to="/admin/command" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Testbereich
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Inhouse-Vorschau, Pipeline-Health und Learner-Context
            </p>
          </div>
          <FactoryTriggerButton />
        </div>
      </div>

      {/* Preview Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Modus:</span>
        {(['standard', 'premium', 'adaptive'] as PreviewMode[]).map(mode => (
          <Button
            key={mode}
            size="sm"
            variant={previewMode === mode ? 'default' : 'outline'}
            className="h-7 text-xs capitalize"
            onClick={() => setPreviewMode(mode)}
          >
            {mode}
          </Button>
        ))}
      </div>

      {/* Forensic Health */}
      <ForensicHealthCard />

      {/* SSOT Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrityFailuresCard />
        <PublishReadinessCard />
      </div>

      {/* Test Priority Queue */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Test-Priorität</span>
            <Link to="/admin/queue" className="text-xs text-muted-foreground hover:text-primary transition-colors font-normal">
              Queue →
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
            <AdminAutoTestQueue previewMode={previewMode} limit={15} />
          </Suspense>
        </CardContent>
      </Card>

      {/* Published Courses Quick Access */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Veröffentlichte Kurse — Schnellzugang</span>
            <Link to="/admin/growth" className="text-xs text-muted-foreground hover:text-primary transition-colors font-normal">
              Growth →
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PublishedCourseList />
        </CardContent>
      </Card>
    </div>
  );
}
