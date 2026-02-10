import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Heart, Activity, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, Shield, BookOpen, Zap, BarChart3, Search, Copy, Trash2,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GoNoGo {
  structureComplete: boolean;
  noDuplicates: boolean;
  fullCoverage: boolean;
  noEmptyContent: boolean;
  minAvgWords: boolean;
  examBlocksPresent: boolean;
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
  benchmarks: {
    go_no_go?: GoNoGo;
    is_go_ready?: boolean;
    duplicate_lesson_ids?: string[];
    missing_competencies?: Array<{ id: string; code: string; title: string; learningField: string }>;
    exam_block_count?: number;
    weight_tag_count?: number;
    expected_lessons?: number;
    lessons_per_competency?: number;
  };
  created_at: string;
  snapshot_type: string;
}

interface CourseWithHealth {
  id: string;
  title: string;
  status: string;
  autopilot_status: string;
  curriculum_id: string;
  snapshot?: HealthSnapshot | null;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: React.ElementType; label: string }> = {
  healthy: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: CheckCircle2, label: 'Release-Ready' },
  warning: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: AlertTriangle, label: 'Nacharbeit nötig' },
  critical: { color: 'text-red-500', bg: 'bg-red-500/10', icon: XCircle, label: 'Nicht release-fähig' },
  unknown: { color: 'text-muted-foreground', bg: 'bg-muted/10', icon: Activity, label: 'Nicht geprüft' },
};

const GO_CHECK_LABELS: Record<string, string> = {
  structureComplete: 'Didaktische Schritte vollständig',
  noDuplicates: 'Keine Duplikate',
  fullCoverage: '100% Kompetenz-Abdeckung',
  noEmptyContent: 'Keine leeren Lektionen',
  minAvgWords: 'Ø Wortzahl ≥ 100',
  examBlocksPresent: 'Prüfungsbezug vorhanden',
};

export default function CourseHealthPage() {
  const [courses, setCourses] = useState<CourseWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    const { data: coursesData } = await supabase
      .from('courses')
      .select('id, title, status, autopilot_status, curriculum_id')
      .order('created_at', { ascending: false });

    const allCourses = (coursesData || []) as CourseWithHealth[];

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

  const runAction = async (courseId: string, type: 'dryRun' | 'seal' | 'validate') => {
    setActionId(courseId);
    setActionType(type);
    try {
      if (type === 'validate') {
        const res = await supabase.functions.invoke('post-validation', {
          method: 'POST',
          body: { courseId },
        });
        if (res.error) throw res.error;
        toast.success('Post-Validierung abgeschlossen');
      } else {
        const res = await supabase.functions.invoke('course-finalizer', {
          method: 'POST',
          body: { courseId, dryRun: type === 'dryRun' },
        });
        if (res.error) throw res.error;
        const data = res.data as any;
        if (data?.error) {
          toast.error(data.error);
        } else if (type === 'dryRun') {
          toast.success(`Dry Run: Score ${data?.healthScore}/100 – ${data?.isGoReady ? '✅ GO' : '❌ NO-GO'}`);
        } else {
          toast.success(`Kurs versiegelt: Score ${data?.healthScore}/100`);
        }
      }
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setActionId(null);
      setActionType(null);
    }
  };

  // Summary stats
  const sealed = courses.filter(c => c.autopilot_status === 'sealed').length;
  const goReady = courses.filter(c => c.snapshot?.benchmarks?.is_go_ready).length;
  const totalLessons = courses.reduce((s, c) => s + (c.snapshot?.lesson_count || 0), 0);
  const avgHealth = courses.filter(c => c.snapshot).length > 0
    ? Math.round(courses.filter(c => c.snapshot).reduce((s, c) => s + (c.snapshot?.health_score || 0), 0) / courses.filter(c => c.snapshot).length)
    : 0;

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
            Kurs-Qualität & Finalisierung
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Go/No-Go Gate · Duplikat-Check · Kompetenz-Abdeckung · Final Seal
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <div className="text-2xl font-bold text-emerald-500">{sealed}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" /> Versiegelt
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className={`text-2xl font-bold ${goReady > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`}>{goReady}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Go-Ready
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-foreground">{totalLessons}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Lektionen
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4 pb-3">
            <div className={`text-2xl font-bold ${avgHealth >= 85 ? 'text-emerald-500' : avgHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
              {avgHealth}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="h-3 w-3" /> Ø Health
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Course List */}
      <div className="space-y-3">
        {courses.map(course => {
          const snap = course.snapshot;
          const sc = STATUS_CONFIG[snap?.health_status || 'unknown'];
          const StatusIcon = sc.icon;
          const isExpanded = expandedCourse === course.id;
          const goNoGo = snap?.benchmarks?.go_no_go;
          const isGo = snap?.benchmarks?.is_go_ready;
          const coveragePercent = snap && snap.competency_count > 0
            ? Math.round((snap.covered_competency_count / snap.competency_count) * 100)
            : 0;
          const isSealed = course.autopilot_status === 'sealed';

          return (
            <Card key={course.id} className="glass-card overflow-hidden">
              {/* Compact Row */}
              <button
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedCourse(isExpanded ? null : course.id)}
              >
                <StatusIcon className={`h-5 w-5 shrink-0 ${sc.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{course.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {snap ? `${snap.lesson_count} Lektionen · ${coveragePercent}% Abdeckung · Ø ${snap.avg_word_count} Wörter` : 'Kein Snapshot'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isGo !== undefined && (
                    <Badge variant={isGo ? "default" : "destructive"} className="text-xs">
                      {isGo ? '✅ GO' : '❌ NO-GO'}
                    </Badge>
                  )}
                  {isSealed && (
                    <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30">
                      🔒 Versiegelt
                    </Badge>
                  )}
                  {snap && (
                    <span className={`text-sm font-bold ${sc.color}`}>{snap.health_score}</span>
                  )}
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-6 pb-5 border-t border-border pt-4 space-y-4">
                  {snap ? (
                    <Tabs defaultValue="checklist" className="space-y-4">
                      <TabsList className="grid grid-cols-4 w-full max-w-md">
                        <TabsTrigger value="checklist">Go/No-Go</TabsTrigger>
                        <TabsTrigger value="issues">Issues ({(snap.issues || []).length})</TabsTrigger>
                        <TabsTrigger value="coverage">Abdeckung</TabsTrigger>
                        <TabsTrigger value="stats">Statistik</TabsTrigger>
                      </TabsList>

                      {/* Go/No-Go Checklist */}
                      <TabsContent value="checklist">
                        <div className="space-y-2">
                          {goNoGo && Object.entries(goNoGo).map(([key, passed]) => (
                            <div key={key} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg ${passed ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                              {passed ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                              )}
                              <span className={`text-sm ${passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                {GO_CHECK_LABELS[key] || key}
                              </span>
                            </div>
                          ))}
                          {!goNoGo && (
                            <p className="text-sm text-muted-foreground">Noch kein Go/No-Go Check durchgeführt. Starte einen Dry Run.</p>
                          )}
                        </div>
                      </TabsContent>

                      {/* Issues */}
                      <TabsContent value="issues">
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-1.5">
                            {(snap.issues || []).length === 0 ? (
                              <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 px-4 py-2.5 rounded-lg">
                                <CheckCircle2 className="h-4 w-4" /> Keine Probleme gefunden
                              </div>
                            ) : (
                              (snap.issues || []).map((issue, i) => (
                                <div key={i} className={`flex items-start gap-2 text-sm px-4 py-2 rounded-lg ${
                                  issue.severity === 'critical' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                }`}>
                                  {issue.severity === 'critical' ? <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                                  <div>
                                    <span className="font-mono text-xs mr-2">[{issue.code}]</span>
                                    {issue.message}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      {/* Coverage */}
                      <TabsContent value="coverage">
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Kompetenz-Abdeckung</span>
                              <span className="font-bold">{snap.covered_competency_count}/{snap.competency_count} ({coveragePercent}%)</span>
                            </div>
                            <Progress value={coveragePercent} className="h-2.5" />
                          </div>

                          {snap.benchmarks?.missing_competencies && snap.benchmarks.missing_competencies.length > 0 && (
                            <div className="space-y-1.5">
                              <h4 className="text-sm font-medium text-red-500">Fehlende Kompetenzen:</h4>
                              {snap.benchmarks.missing_competencies.map((mc, i) => (
                                <div key={i} className="text-sm bg-red-500/10 px-3 py-1.5 rounded-lg text-red-700 dark:text-red-400">
                                  <span className="font-mono text-xs">{mc.code}</span> – {mc.title}
                                  <span className="text-xs ml-2 opacity-70">({mc.learningField})</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Step Distribution */}
                          {snap.step_distribution && (
                            <div>
                              <h4 className="text-sm font-medium text-muted-foreground mb-2">Schritt-Verteilung:</h4>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(snap.step_distribution).map(([step, count]) => (
                                  <Badge key={step} variant="secondary" className="text-xs font-mono">
                                    {step}: {count as number}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </TabsContent>

                      {/* Stats */}
                      <TabsContent value="stats">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.lesson_count}</div>
                            <div className="text-xs text-muted-foreground">Lektionen</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className={`text-lg font-bold ${snap.duplicate_titles > 0 ? 'text-amber-500' : ''}`}>{snap.duplicate_titles}</div>
                            <div className="text-xs text-muted-foreground">Duplikate</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className={`text-lg font-bold ${snap.empty_content_count > 0 ? 'text-red-500' : ''}`}>{snap.empty_content_count}</div>
                            <div className="text-xs text-muted-foreground">Leer/Minimal</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.avg_word_count}</div>
                            <div className="text-xs text-muted-foreground">Ø Wörter</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.benchmarks?.exam_block_count || 0}</div>
                            <div className="text-xs text-muted-foreground">Prüfungsblöcke</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.benchmarks?.weight_tag_count || 0}</div>
                            <div className="text-xs text-muted-foreground">Gewichtungs-Tags</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.benchmarks?.expected_lessons || '–'}</div>
                            <div className="text-xs text-muted-foreground">Soll-Lektionen</div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3">
                            <div className="text-lg font-bold">{snap.benchmarks?.lessons_per_competency || '–'}</div>
                            <div className="text-xs text-muted-foreground">Lektionen/Kompetenz</div>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <p className="text-sm text-muted-foreground">Kein Snapshot vorhanden. Starte einen Dry Run zur Analyse.</p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runAction(course.id, 'dryRun')}
                      disabled={actionId === course.id}
                    >
                      {actionId === course.id && actionType === 'dryRun' ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Prüfe…</>
                      ) : (
                        <><Search className="h-4 w-4 mr-1" /> Dry Run (Go/No-Go prüfen)</>
                      )}
                    </Button>

                    {!isSealed && (
                      <Button
                        size="sm"
                        onClick={() => runAction(course.id, 'seal')}
                        disabled={actionId === course.id}
                      >
                        {actionId === course.id && actionType === 'seal' ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Versiegeln…</>
                        ) : (
                          <><Shield className="h-4 w-4 mr-1" /> Final Gate & Seal</>
                        )}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runAction(course.id, 'validate')}
                      disabled={actionId === course.id}
                    >
                      {actionId === course.id && actionType === 'validate' ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Validiere…</>
                      ) : (
                        <><Activity className="h-4 w-4 mr-1" /> Post-Validierung</>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
