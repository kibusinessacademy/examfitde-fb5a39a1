import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Heart, Activity, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, Shield, BookOpen, Zap, BarChart3
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface CourseWithHealth {
  id: string;
  title: string;
  status: string;
  autopilot_status: string;
  curriculum_id: string;
  snapshot?: HealthSnapshot | null;
}

interface HealthSnapshot {
  id: string;
  health_score: number;
  health_status: string;
  lesson_count: number;
  competency_count: number;
  covered_competency_count: number;
  duplicate_titles: number;
  empty_content_count: number;
  avg_word_count: number;
  step_distribution: Record<string, number>;
  issues: Array<{ severity: string; code: string; message: string; count?: number }>;
  benchmarks: Record<string, unknown>;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  healthy: { color: 'text-emerald-500', icon: CheckCircle2, label: 'Gesund' },
  warning: { color: 'text-amber-500', icon: AlertTriangle, label: 'Warnung' },
  critical: { color: 'text-red-500', icon: XCircle, label: 'Kritisch' },
  unknown: { color: 'text-muted-foreground', icon: Activity, label: 'Unbekannt' },
};

const AUTOPILOT_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  idle: { label: 'Idle', variant: 'outline' },
  running: { label: 'Läuft', variant: 'secondary' },
  generating: { label: 'Generiert', variant: 'secondary' },
  finalizing: { label: 'Finalisiert', variant: 'default' },
  sealed: { label: '✓ Versiegelt', variant: 'default' },
};

export default function CourseHealthPage() {
  const [courses, setCourses] = useState<CourseWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [sealingId, setSealingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    // Load courses with autopilot fields
    const { data: coursesData } = await supabase
      .from('courses')
      .select('id, title, status, autopilot_status, curriculum_id')
      .order('created_at', { ascending: false });

    const allCourses = (coursesData || []) as CourseWithHealth[];

    // Load latest snapshots for each course
    if (allCourses.length > 0) {
      const courseIds = allCourses.map(c => c.id);
      const { data: snapshots } = await supabase
        .from('course_health_snapshots')
        .select('*')
        .in('course_id', courseIds)
        .order('created_at', { ascending: false }) as { data: (HealthSnapshot & { course_id: string })[] | null };

      const snapshotMap = new Map<string, HealthSnapshot>();
      for (const snap of (snapshots || [])) {
        if (!snapshotMap.has(snap.course_id)) {
          snapshotMap.set(snap.course_id, snap);
        }
      }

      for (const course of allCourses) {
        course.snapshot = snapshotMap.get(course.id) || null;
      }
    }

    setCourses(allCourses);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSeal = async (courseId: string) => {
    setSealingId(courseId);
    try {
      const res = await supabase.functions.invoke('course-finalizer', {
        method: 'POST',
        body: { courseId },
      });
      if (res.error) throw res.error;
      const data = res.data as { healthScore?: number; healthStatus?: string };
      toast.success(`Kurs versiegelt: Score ${data?.healthScore}/100 (${data?.healthStatus})`);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Finalizer-Fehler', { description: msg });
    } finally {
      setSealingId(null);
    }
  };

  const handlePostValidation = async (courseId: string) => {
    setValidatingId(courseId);
    try {
      const res = await supabase.functions.invoke('post-validation', {
        method: 'POST',
        body: { courseId },
      });
      if (res.error) throw res.error;
      const data = res.data as { totalFindings?: number; totalManualReview?: number };
      toast.success(`Validierung abgeschlossen: ${data?.totalFindings} Findings, ${data?.totalManualReview} zur Prüfung`);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Validierungs-Fehler', { description: msg });
    } finally {
      setValidatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Heart className="h-6 w-6 text-primary" />
            Kurs-Health-Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Qualitätsstatus · Ampelsystem · AutoPilot-Kontrolle
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-foreground">{courses.length}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Kurse gesamt
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-emerald-500">
              {courses.filter(c => c.autopilot_status === 'sealed').length}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" /> Versiegelt
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-amber-500">
              {courses.filter(c => ['running', 'generating'].includes(c.autopilot_status)).length}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" /> In Generierung
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-foreground">
              {courses.filter(c => c.snapshot).reduce((sum, c) => sum + (c.snapshot?.lesson_count || 0), 0)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Lektionen gesamt
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Course Cards */}
      <div className="space-y-4">
        {courses.map(course => {
          const snapshot = course.snapshot;
          const statusConfig = STATUS_CONFIG[snapshot?.health_status || 'unknown'];
          const StatusIcon = statusConfig.icon;
          const apLabel = AUTOPILOT_LABELS[course.autopilot_status] || AUTOPILOT_LABELS.idle;
          const coveragePercent = snapshot && snapshot.competency_count > 0
            ? Math.round((snapshot.covered_competency_count / snapshot.competency_count) * 100)
            : 0;

          return (
            <Card key={course.id} className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-3">
                    <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
                    {course.title}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={apLabel.variant} className="text-xs">
                      {apLabel.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {course.id.slice(0, 8)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {snapshot ? (
                  <>
                    {/* Health Score Bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Health Score</span>
                        <span className={`font-bold ${statusConfig.color}`}>
                          {snapshot.health_score}/100 · {statusConfig.label}
                        </span>
                      </div>
                      <Progress
                        value={snapshot.health_score}
                        className="h-2"
                      />
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <div className="text-lg font-bold text-foreground">{snapshot.lesson_count}</div>
                        <div className="text-xs text-muted-foreground">Lektionen</div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <div className="text-lg font-bold text-foreground">{coveragePercent}%</div>
                        <div className="text-xs text-muted-foreground">
                          Abdeckung ({snapshot.covered_competency_count}/{snapshot.competency_count})
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <div className={`text-lg font-bold ${snapshot.duplicate_titles > 0 ? 'text-amber-500' : 'text-foreground'}`}>
                          {snapshot.duplicate_titles}
                        </div>
                        <div className="text-xs text-muted-foreground">Duplikate</div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <div className={`text-lg font-bold ${snapshot.empty_content_count > 0 ? 'text-red-500' : 'text-foreground'}`}>
                          {snapshot.empty_content_count}
                        </div>
                        <div className="text-xs text-muted-foreground">Leer</div>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <div className="text-lg font-bold text-foreground">{snapshot.avg_word_count}</div>
                        <div className="text-xs text-muted-foreground">Ø Wörter</div>
                      </div>
                    </div>

                    {/* Step Distribution */}
                    {snapshot.step_distribution && Object.keys(snapshot.step_distribution).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(snapshot.step_distribution).map(([step, count]) => (
                          <Badge key={step} variant="secondary" className="text-xs font-mono">
                            {step}: {count as number}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Issues */}
                    {snapshot.issues && snapshot.issues.length > 0 && (
                      <div className="space-y-1.5">
                        {snapshot.issues.map((issue, i) => (
                          <div key={i} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${
                            issue.severity === 'critical' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                          }`}>
                            {issue.severity === 'critical' ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                            {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground py-2">
                    Kein Health-Snapshot vorhanden. Kurs versiegeln für Analyse.
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  {course.autopilot_status !== 'sealed' && (
                    <Button
                      size="sm"
                      onClick={() => handleSeal(course.id)}
                      disabled={sealingId === course.id}
                    >
                      {sealingId === course.id ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Versiegeln…</>
                      ) : (
                        <><Shield className="h-4 w-4 mr-1" /> Final Gate & Seal</>
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePostValidation(course.id)}
                    disabled={validatingId === course.id}
                  >
                    {validatingId === course.id ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Validierung…</>
                    ) : (
                      <><Activity className="h-4 w-4 mr-1" /> Post-Validierung</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
