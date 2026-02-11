import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Heart, Activity, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, Shield, BookOpen, BarChart3, Search,
  ChevronDown, ChevronRight, Zap, Scale, Brain, FileWarning, Layers
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GateInfo {
  gate: number;
  name: string;
  status: 'passed' | 'failed' | 'warning';
  score: number;
  issueCount: number;
}

interface GateDetail extends GateInfo {
  issues: Array<{ severity: string; code: string; message: string; lessonId?: string }>;
}

interface QualityReport {
  ssot_valid: boolean;
  structure_valid: boolean;
  minicheck_structured: boolean;
  exam_blocks_complete: boolean;
  weighting_complete: boolean;
  bloat_ok: boolean;
  mastery_calculable: boolean;
  duplicate_count: number;
  bloat_score: number;
  final_status: string;
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
  issues: Array<{ severity: string; code: string; message: string }>;
  benchmarks: {
    gates?: GateInfo[];
    quality_report?: QualityReport;
    publishing_status?: string;
    is_go_ready?: boolean;
    go_no_go?: Record<string, boolean>;
    quarantined_lessons?: number;
    auto_fixed_duplicates?: number;
    missing_competencies?: Array<{ id: string; code: string; title: string; learningField: string }>;
    exam_block_count?: number;
    expected_lessons?: number;
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
  quality_score?: number;
  publishing_status?: string;
  quality_report?: QualityReport;
  snapshot?: HealthSnapshot | null;
}

const GATE_ICONS: Record<number, React.ElementType> = {
  1: Shield, 2: Layers, 3: Brain, 4: BookOpen, 5: Scale, 6: FileWarning, 7: BarChart3,
};

const GATE_LABELS: Record<number, string> = {
  1: 'SSOT', 2: 'Struktur', 3: 'MiniCheck', 4: 'Prüfung', 5: 'Gewichtung', 6: 'Bloat', 7: 'Mastery',
};

const STATUS_COLORS: Record<string, string> = {
  passed: 'text-emerald-500 bg-emerald-500/15 border-emerald-500/30',
  failed: 'text-red-500 bg-red-500/15 border-red-500/30',
  warning: 'text-amber-500 bg-amber-500/15 border-amber-500/30',
  pending: 'text-muted-foreground bg-muted/15 border-border',
};

const PUBLISHING_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-muted-foreground' },
  ssot_validated: { label: 'SSOT ✓', color: 'text-blue-500' },
  structurally_valid: { label: 'Struktur ✓', color: 'text-blue-500' },
  minicheck_valid: { label: 'MiniCheck ✓', color: 'text-blue-500' },
  exam_ready: { label: 'Prüfung ✓', color: 'text-indigo-500' },
  weighted: { label: 'Gewichtet ✓', color: 'text-indigo-500' },
  bloat_checked: { label: 'Bloat ✓', color: 'text-indigo-500' },
  mastery_ready: { label: 'Mastery ✓', color: 'text-violet-500' },
  publishable: { label: '🚀 Publishable', color: 'text-emerald-500' },
  published: { label: '✅ Published', color: 'text-emerald-600' },
  quality_failed: { label: '🔴 Blocked', color: 'text-red-500' },
};

export default function CourseHealthPage() {
  const [courses, setCourses] = useState<CourseWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [gateDetails, setGateDetails] = useState<Record<string, GateDetail[]>>({});

  const loadData = async () => {
    setLoading(true);
    const { data: coursesData } = await supabase
      .from('courses')
      .select('id, title, status, autopilot_status, curriculum_id, quality_score, publishing_status, quality_report')
      .order('created_at', { ascending: false });

    const allCourses = (coursesData || []) as unknown as CourseWithHealth[];

    if (allCourses.length > 0) {
      const courseIds = allCourses.map(c => c.id);
      const { data: snapshots } = await supabase
        .from('course_health_snapshots')
        .select('*')
        .in('course_id', courseIds)
        .order('created_at', { ascending: false });

      const snapshotMap = new Map<string, HealthSnapshot>();
      for (const snap of (snapshots as any[] || [])) {
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

  const runQualityGate = async (courseId: string, fix = false) => {
    setActionId(courseId);
    setActionType(fix ? 'fix' : 'check');
    try {
      const res = await supabase.functions.invoke('quality-gate-check', {
        method: 'POST',
        body: { courseId, fix },
      });
      if (res.error) throw res.error;
      const data = res.data as any;
      if (data?.error) {
        toast.error(data.error);
      } else {
        const emoji = data.qualityScore >= 85 ? '🟢' : data.qualityScore >= 60 ? '🟡' : '🔴';
        toast.success(`${emoji} Quality Score: ${data.qualityScore}/100 – ${data.publishingStatus}${fix ? ` | ${data.stats?.autoFixed || 0} auto-fixed` : ''}`);
        if (data.gateDetails) {
          setGateDetails(prev => ({ ...prev, [courseId]: data.gateDetails }));
        }
      }
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
      setActionType(null);
    }
  };

  const runLegacyAction = async (courseId: string, type: 'dryRun' | 'seal' | 'validate') => {
    setActionId(courseId);
    setActionType(type);
    try {
      if (type === 'validate') {
        const res = await supabase.functions.invoke('post-validation', { method: 'POST', body: { courseId } });
        if (res.error) throw res.error;
        toast.success('Post-Validierung abgeschlossen');
      } else {
        const res = await supabase.functions.invoke('course-finalizer', { method: 'POST', body: { courseId, dryRun: type === 'dryRun' } });
        if (res.error) throw res.error;
        const data = res.data as any;
        if (data?.error) toast.error(data.error);
        else toast.success(`${type === 'dryRun' ? 'Dry Run' : 'Sealed'}: Score ${data?.healthScore}/100`);
      }
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
      setActionType(null);
    }
  };

  // Summary stats
  const sealed = courses.filter(c => c.autopilot_status === 'sealed').length;
  const publishable = courses.filter(c => c.publishing_status === 'publishable').length;
  const totalLessons = courses.reduce((s, c) => s + (c.snapshot?.lesson_count || 0), 0);
  const avgHealth = courses.filter(c => c.quality_score).length > 0
    ? Math.round(courses.filter(c => c.quality_score).reduce((s, c) => s + (c.quality_score || 0), 0) / courses.filter(c => c.quality_score).length)
    : 0;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Heart className="h-6 w-6 text-primary" />
            7-Gate Quality System
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            SSOT · Struktur · MiniCheck · Prüfung · Gewichtung · Bloat · Mastery
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-2xl font-bold text-foreground">{courses.length}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><BookOpen className="h-3 w-3" /> Kurse</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-2xl font-bold text-emerald-500">{publishable}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> Publishable</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-2xl font-bold text-emerald-500">{sealed}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" /> Versiegelt</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-2xl font-bold text-foreground">{totalLessons}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Lektionen</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className={`text-2xl font-bold ${avgHealth >= 85 ? 'text-emerald-500' : avgHealth >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{avgHealth || '–'}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Ø Quality</div>
        </CardContent></Card>
      </div>

      {/* Course List */}
      <div className="space-y-3">
        {courses.map(course => {
          const snap = course.snapshot;
          const qScore = course.quality_score || snap?.health_score || 0;
          const pubStatus = course.publishing_status || snap?.benchmarks?.publishing_status || 'draft';
          const pubInfo = PUBLISHING_LABELS[pubStatus] || PUBLISHING_LABELS.draft;
          const gatesFromSnap = snap?.benchmarks?.gates as GateInfo[] | undefined;
          const detailedGates = gateDetails[course.id];
          const displayGates = detailedGates || gatesFromSnap;
          const isExpanded = expandedCourse === course.id;
          const isSealed = course.autopilot_status === 'sealed';
          const scoreColor = qScore >= 85 ? 'text-emerald-500' : qScore >= 60 ? 'text-amber-500' : qScore > 0 ? 'text-red-500' : 'text-muted-foreground';

          return (
            <Card key={course.id} className="overflow-hidden">
              <button
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedCourse(isExpanded ? null : course.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{course.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span className={pubInfo.color}>{pubInfo.label}</span>
                    {snap && <span>· {snap.lesson_count} Lektionen</span>}
                  </div>
                </div>

                {/* Mini Gate Indicators */}
                {displayGates && (
                  <div className="flex items-center gap-1 shrink-0">
                    {displayGates.map(g => {
                      const color = g.status === 'passed' ? 'bg-emerald-500' : g.status === 'failed' ? 'bg-red-500' : 'bg-amber-500';
                      return <div key={g.gate} className={`w-2.5 h-2.5 rounded-full ${color}`} title={`G${g.gate}: ${g.name} (${g.score})`} />;
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  {isSealed && <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30">🔒</Badge>}
                  <span className={`text-lg font-bold ${scoreColor}`}>{qScore || '–'}</span>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-6 pb-5 border-t border-border pt-4 space-y-4">
                  {/* Gate Grid */}
                  {displayGates && (
                    <div className="grid grid-cols-7 gap-2">
                      {[1, 2, 3, 4, 5, 6, 7].map(gNum => {
                        const g = displayGates.find(x => x.gate === gNum);
                        const Icon = GATE_ICONS[gNum];
                        const st = g?.status || 'pending';
                        const colors = STATUS_COLORS[st];
                        return (
                          <div key={gNum} className={`rounded-lg border p-3 text-center ${colors}`}>
                            <Icon className="h-5 w-5 mx-auto mb-1" />
                            <div className="text-xs font-medium">{GATE_LABELS[gNum]}</div>
                            <div className="text-lg font-bold">{g?.score ?? '–'}</div>
                            {g && <div className="text-[10px] mt-0.5">{g.issueCount} Issues</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Quality Score Bar */}
                  {qScore > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Quality Score</span>
                        <span className={`font-bold ${scoreColor}`}>{qScore}/100</span>
                      </div>
                      <Progress value={qScore} className="h-3" />
                    </div>
                  )}

                  {/* Detailed Issues */}
                  {detailedGates && (
                    <Tabs defaultValue="all" className="space-y-3">
                      <TabsList className="w-full justify-start overflow-x-auto">
                        <TabsTrigger value="all">Alle Issues</TabsTrigger>
                        {detailedGates.filter(g => g.issues.length > 0).map(g => (
                          <TabsTrigger key={g.gate} value={`g${g.gate}`} className="text-xs">
                            G{g.gate} ({g.issues.length})
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      <TabsContent value="all">
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-1">
                            {detailedGates.flatMap(g => g.issues).length === 0 ? (
                              <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 px-4 py-2.5 rounded-lg">
                                <CheckCircle2 className="h-4 w-4" /> Alle Gates bestanden – keine Probleme
                              </div>
                            ) : (
                              detailedGates.flatMap(g => g.issues.map(i => ({ ...i, gate: g.gate }))).map((issue, idx) => (
                                <div key={idx} className={`flex items-start gap-2 text-sm px-4 py-2 rounded-lg ${
                                  issue.severity === 'critical' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                }`}>
                                  {issue.severity === 'critical' ? <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                                  <div>
                                    <span className="font-mono text-xs mr-1.5">G{issue.gate}</span>
                                    <span className="font-mono text-xs mr-2">[{issue.code}]</span>
                                    {issue.message}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      {detailedGates.filter(g => g.issues.length > 0).map(g => (
                        <TabsContent key={g.gate} value={`g${g.gate}`}>
                          <ScrollArea className="max-h-[250px]">
                            <div className="space-y-1">
                              {g.issues.map((issue, idx) => (
                                <div key={idx} className={`flex items-start gap-2 text-sm px-4 py-2 rounded-lg ${
                                  issue.severity === 'critical' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                }`}>
                                  {issue.severity === 'critical' ? <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                                  <span>{issue.message}</span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </TabsContent>
                      ))}
                    </Tabs>
                  )}

                  {/* Legacy snapshot data */}
                  {!detailedGates && snap && (
                    <div className="text-sm text-muted-foreground">
                      Letzte Prüfung: {new Date(snap.created_at).toLocaleString('de-DE')} · {snap.lesson_count} Lektionen · Ø {snap.avg_word_count} Wörter
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <Button size="sm" onClick={() => runQualityGate(course.id)} disabled={!!actionId}>
                      {actionId === course.id && actionType === 'check' ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Prüfe…</> : <><Search className="h-4 w-4 mr-1" /> 7-Gate Check</>}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runQualityGate(course.id, true)} disabled={!!actionId}>
                      {actionId === course.id && actionType === 'fix' ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Fixe…</> : <><Zap className="h-4 w-4 mr-1" /> Check + Auto-Fix</>}
                    </Button>
                    {!isSealed && (
                      <Button size="sm" variant="outline" onClick={() => runLegacyAction(course.id, 'seal')} disabled={!!actionId}>
                        <Shield className="h-4 w-4 mr-1" /> Final Seal
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => runLegacyAction(course.id, 'validate')} disabled={!!actionId}>
                      <Activity className="h-4 w-4 mr-1" /> Post-Validierung
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
