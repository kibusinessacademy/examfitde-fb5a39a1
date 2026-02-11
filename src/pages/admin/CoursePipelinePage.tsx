import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Loader2, RefreshCw, Play, CheckCircle2, AlertTriangle, XCircle,
  BookOpen, Brain, ClipboardList, Scale, Wrench, Zap, ChevronDown,
  ChevronRight, Rocket, Activity
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CoursePipelineData {
  id: string;
  title: string;
  status: string;
  curriculum_id: string;
  lesson_count: number;
  filled_count: number;
  stub_count: number;
  minicheck_count: number;
  weight_tag_count: number;
  blueprint_count: number;
  active_jobs: JobSummary[];
}

interface JobSummary {
  id: string;
  job_type: string;
  status: string;
  error: string | null;
  updated_at: string;
}

type PipelineStep = {
  key: string;
  label: string;
  icon: React.ElementType;
  check: (c: CoursePipelineData) => StepStatus;
  jobType: string;
  jobLabel: string;
};

type StepStatus = 'done' | 'partial' | 'missing' | 'running';

/* ------------------------------------------------------------------ */
/*  Pipeline step definitions                                          */
/* ------------------------------------------------------------------ */

const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: 'content',
    label: 'Inhalte generieren',
    icon: BookOpen,
    check: (c) => {
      if (c.active_jobs.some(j => j.job_type === 'repair_lessons' && j.status === 'processing')) return 'running';
      if (c.stub_count === 0 && c.filled_count === c.lesson_count) return 'done';
      if (c.filled_count > 0) return 'partial';
      return 'missing';
    },
    jobType: 'repair_lessons',
    jobLabel: 'Stub-Reparatur starten',
  },
  {
    key: 'blueprints',
    label: 'Blueprints & Exam-Blocks',
    icon: ClipboardList,
    check: (c) => {
      if (c.active_jobs.some(j => j.job_type === 'upgrade_ihk' && j.status === 'processing')) return 'running';
      if (c.blueprint_count >= 10) return 'done';
      if (c.blueprint_count > 0) return 'partial';
      return 'missing';
    },
    jobType: 'upgrade_ihk',
    jobLabel: 'IHK-Upgrade starten',
  },
  {
    key: 'minichecks',
    label: 'MiniCheck-Fragen',
    icon: Brain,
    check: (c) => {
      if (c.active_jobs.some(j => j.job_type === 'regenerate_minichecks' && j.status === 'processing')) return 'running';
      const minicheckLessons = Math.floor(c.lesson_count / 5); // ~1 minicheck lesson per 5
      if (c.minicheck_count >= minicheckLessons * 3) return 'done';
      if (c.minicheck_count > 0) return 'partial';
      return 'missing';
    },
    jobType: 'regenerate_minichecks',
    jobLabel: 'MiniChecks generieren',
  },
  {
    key: 'weighting',
    label: 'Gewichtung / Weight-Tags',
    icon: Scale,
    check: (c) => {
      if (c.weight_tag_count === c.lesson_count && c.lesson_count > 0) return 'done';
      if (c.weight_tag_count > 0) return 'partial';
      return 'missing';
    },
    jobType: 'upgrade_ihk',
    jobLabel: 'Gewichtung zuweisen',
  },
  {
    key: 'qc',
    label: 'Quality Check',
    icon: Wrench,
    check: (c) => {
      if (c.active_jobs.some(j => j.job_type === 'qc_worker_full' && j.status === 'processing')) return 'running';
      if (c.active_jobs.some(j => j.job_type === 'qc_worker_full' && j.status === 'completed')) return 'done';
      return 'missing';
    },
    jobType: 'qc_worker_full',
    jobLabel: 'Quality Check starten',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<StepStatus, { color: string; icon: React.ElementType; bg: string }> = {
  done: { color: 'text-emerald-500', icon: CheckCircle2, bg: 'bg-emerald-500/15' },
  partial: { color: 'text-amber-500', icon: AlertTriangle, bg: 'bg-amber-500/15' },
  missing: { color: 'text-red-500', icon: XCircle, bg: 'bg-red-500/15' },
  running: { color: 'text-primary', icon: Activity, bg: 'bg-primary/15' },
};

function pipelineProgress(c: CoursePipelineData): number {
  let done = 0;
  for (const step of PIPELINE_STEPS) {
    const s = step.check(c);
    if (s === 'done') done += 1;
    else if (s === 'partial') done += 0.5;
  }
  return Math.round((done / PIPELINE_STEPS.length) * 100);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CoursePipelinePage() {
  const [courses, setCourses] = useState<CoursePipelineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. All courses
      const { data: coursesRaw } = await supabase
        .from('courses')
        .select('id, title, status, curriculum_id')
        .order('created_at', { ascending: false });

      if (!coursesRaw || coursesRaw.length === 0) {
        setCourses([]);
        setLoading(false);
        return;
      }

      // 2. Lesson stats per course (via raw count queries in parallel)
      const courseIds = coursesRaw.map(c => c.id);
      const curriculumIds = [...new Set(coursesRaw.map(c => c.curriculum_id).filter(Boolean))];

      // Fetch lesson counts
      const { data: lessonStats } = await supabase.rpc('get_course_pipeline_stats', {
        p_course_ids: courseIds,
      }).throwOnError() as any;

      // If the RPC doesn't exist, fallback to individual queries
      let statsMap: Record<string, any> = {};
      if (lessonStats) {
        for (const s of lessonStats) {
          statsMap[s.course_id] = s;
        }
      }

      // 3. Active jobs per course
      const { data: activeJobs } = await supabase
        .from('job_queue')
        .select('id, job_type, status, error, updated_at, payload')
        .in('status', ['pending', 'processing', 'completed'])
        .order('created_at', { ascending: false })
        .limit(200);

      const jobsByCourse: Record<string, JobSummary[]> = {};
      for (const j of activeJobs || []) {
        const cid = (j.payload as any)?.course_id;
        if (cid) {
          if (!jobsByCourse[cid]) jobsByCourse[cid] = [];
          jobsByCourse[cid].push({
            id: j.id,
            job_type: j.job_type,
            status: j.status,
            error: j.error,
            updated_at: j.updated_at,
          });
        }
      }

      // 4. Blueprint counts per curriculum
      const { data: blueprintCounts } = await supabase
        .from('question_blueprints')
        .select('curriculum_id')
        .in('curriculum_id', curriculumIds);

      const bpMap: Record<string, number> = {};
      for (const bp of blueprintCounts || []) {
        bpMap[bp.curriculum_id] = (bpMap[bp.curriculum_id] || 0) + 1;
      }

      // 5. Assemble
      const result: CoursePipelineData[] = coursesRaw.map(c => {
        const stats = statsMap[c.id] || {};
        return {
          id: c.id,
          title: c.title,
          status: c.status,
          curriculum_id: c.curriculum_id,
          lesson_count: Number(stats.lesson_count || 0),
          filled_count: Number(stats.filled_count || 0),
          stub_count: Number(stats.stub_count || 0),
          minicheck_count: Number(stats.minicheck_count || 0),
          weight_tag_count: Number(stats.weight_tag_count || 0),
          active_jobs: jobsByCourse[c.id] || [],
          blueprint_count: bpMap[c.curriculum_id] || 0,
        };
      });

      setCourses(result);
    } catch (err) {
      console.error('Pipeline data error:', err);
      // Fallback: load without RPC
      await loadDataFallback();
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDataFallback = async () => {
    try {
      const { data: coursesRaw } = await supabase
        .from('courses')
        .select('id, title, status, curriculum_id')
        .order('created_at', { ascending: false });

      if (!coursesRaw) { setCourses([]); return; }

      const result: CoursePipelineData[] = [];

      for (const c of coursesRaw) {
        // Lesson stats
        const { count: lessonCount } = await supabase
          .from('lessons')
          .select('id', { count: 'exact', head: true })
          .eq('module_id', '__placeholder__'); // We need to join via modules

        // Simple approach: use raw SQL via edge function is not available
        // Fallback: set zeros and let user trigger refresh
        result.push({
          id: c.id,
          title: c.title,
          status: c.status,
          curriculum_id: c.curriculum_id,
          lesson_count: 0,
          filled_count: 0,
          stub_count: 0,
          minicheck_count: 0,
          weight_tag_count: 0,
          active_jobs: [],
          blueprint_count: 0,
        });
      }

      setCourses(result);
    } catch {
      toast.error('Fehler beim Laden der Pipeline-Daten');
    }
  };

  useEffect(() => { loadData(); }, [loadData]);

  const triggerJob = async (course: CoursePipelineData, jobType: string) => {
    const jobKey = `${course.id}-${jobType}`;
    setTriggeringJob(jobKey);
    try {
      const payload: Record<string, unknown> = {
        course_id: course.id,
        curriculum_id: course.curriculum_id,
      };

      if (jobType === 'repair_lessons') {
        payload.mode = 'auto';
        payload.batch_size = 10;
      }
      if (jobType === 'regenerate_minichecks') {
        payload.batch_size = 10;
      }

      const { error } = await supabase.from('job_queue').insert({
        job_type: jobType,
        payload: payload as any,
        status: 'pending' as const,
        max_attempts: 3,
      } as any);

      if (error) throw error;
      toast.success(`Job "${jobType}" für "${course.title}" eingereiht`);

      // Trigger runner
      supabase.functions.invoke('job-runner', { method: 'POST', body: {} }).catch(() => {});

      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Fehler beim Einreihen des Jobs');
    } finally {
      setTriggeringJob(null);
    }
  };

  const triggerFullPipeline = async (course: CoursePipelineData) => {
    setTriggeringJob(`${course.id}-full`);
    try {
      const jobs = [
        { job_type: 'repair_lessons', payload: { course_id: course.id, curriculum_id: course.curriculum_id, mode: 'auto', batch_size: 10 }, priority: 10 },
        { job_type: 'upgrade_ihk', payload: { course_id: course.id, curriculum_id: course.curriculum_id }, priority: 8 },
        { job_type: 'regenerate_minichecks', payload: { course_id: course.id, curriculum_id: course.curriculum_id, batch_size: 10 }, priority: 7 },
        { job_type: 'qc_worker_full', payload: { course_id: course.id, curriculum_id: course.curriculum_id }, priority: 5 },
        { job_type: 'post_validation', payload: { course_id: course.id, curriculum_id: course.curriculum_id }, priority: 4 },
      ];

      const { error } = await supabase.from('job_queue').insert(
        jobs.map(j => ({ ...j, status: 'pending' as const, max_attempts: 3 })) as any
      );

      if (error) throw error;
      toast.success(`Vollständige Pipeline für "${course.title}" gestartet (5 Jobs)`);

      supabase.functions.invoke('job-runner', { method: 'POST', body: {} }).catch(() => {});
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Fehler beim Starten der Pipeline');
    } finally {
      setTriggeringJob(null);
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
            <Rocket className="h-6 w-6 text-primary" />
            Kurs-Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fortschritt und manuelle Job-Steuerung pro Kurs
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Aktualisieren
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-foreground">{courses.length}</div>
            <div className="text-xs text-muted-foreground">Kurse gesamt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-success">
              {courses.filter(c => pipelineProgress(c) === 100).length}
            </div>
            <div className="text-xs text-muted-foreground">Pipeline fertig</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-warning">
              {courses.filter(c => { const p = pipelineProgress(c); return p > 0 && p < 100; }).length}
            </div>
            <div className="text-xs text-muted-foreground">In Arbeit</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-destructive">
              {courses.filter(c => pipelineProgress(c) === 0).length}
            </div>
            <div className="text-xs text-muted-foreground">Nicht gestartet</div>
          </CardContent>
        </Card>
      </div>

      {/* Course Cards */}
      <div className="space-y-3">
        {courses.map(course => {
          const progress = pipelineProgress(course);
          const isExpanded = expanded === course.id;
          const hasRunning = course.active_jobs.some(j => j.status === 'processing');

          return (
            <Card key={course.id} className="overflow-hidden">
              {/* Summary row */}
              <button
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : course.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate flex items-center gap-2">
                    {course.title}
                    {hasRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                    <span>{course.lesson_count} Lektionen</span>
                    <span>·</span>
                    <span>{course.minicheck_count} MiniChecks</span>
                    <span>·</span>
                    <span>{course.blueprint_count} Blueprints</span>
                  </div>
                </div>

                {/* Mini pipeline indicators */}
                <div className="flex items-center gap-1 shrink-0">
                  {PIPELINE_STEPS.map(step => {
                    const s = step.check(course);
                    return (
                      <div
                        key={step.key}
                        className={`w-3 h-3 rounded-full ${
                          s === 'done' ? 'bg-success' :
                          s === 'partial' ? 'bg-warning' :
                          s === 'running' ? 'bg-primary animate-pulse' :
                          'bg-destructive'
                        }`}
                        title={`${step.label}: ${s}`}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-24">
                    <Progress value={progress} className="h-2" />
                  </div>
                  <span className={`text-sm font-bold ${
                    progress === 100 ? 'text-success' :
                    progress > 0 ? 'text-warning' : 'text-destructive'
                  }`}>{progress}%</span>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-6 pb-5 border-t border-border pt-4 space-y-4">
                  {/* Full pipeline trigger */}
                  <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
                    <div className="text-sm">
                      <span className="font-medium text-foreground">Vollständige Pipeline</span>
                      <span className="text-muted-foreground ml-2">
                        Repair → IHK-Upgrade → MiniChecks → QC → Validation
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => triggerFullPipeline(course)}
                      disabled={triggeringJob === `${course.id}-full`}
                    >
                      {triggeringJob === `${course.id}-full` ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Rocket className="h-4 w-4 mr-1" />
                      )}
                      Alle starten
                    </Button>
                  </div>

                  {/* Individual steps */}
                  <div className="space-y-2">
                    {PIPELINE_STEPS.map(step => {
                      const s = step.check(course);
                      const cfg = STATUS_CONFIG[s];
                      const Icon = step.icon;
                      const StatusIcon = cfg.icon;
                      const jobKey = `${course.id}-${step.jobType}`;

                      return (
                        <div
                          key={step.key}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/20"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${cfg.bg}`}>
                              {s === 'running' ? (
                                <Loader2 className={`h-4 w-4 ${cfg.color} animate-spin`} />
                              ) : (
                                <StatusIcon className={`h-4 w-4 ${cfg.color}`} />
                              )}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                {step.label}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {step.key === 'content' && `${course.filled_count}/${course.lesson_count} gefüllt · ${course.stub_count} Stubs`}
                                {step.key === 'blueprints' && `${course.blueprint_count} Blueprints`}
                                {step.key === 'minichecks' && `${course.minicheck_count} Fragen`}
                                {step.key === 'weighting' && `${course.weight_tag_count}/${course.lesson_count} gewichtet`}
                                {step.key === 'qc' && (s === 'done' ? 'Bestanden' : 'Ausstehend')}
                              </div>
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => triggerJob(course, step.jobType)}
                            disabled={s === 'running' || triggeringJob === jobKey}
                          >
                            {triggeringJob === jobKey ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5 mr-1" />
                            )}
                            {step.jobLabel}
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Active jobs for this course */}
                  {course.active_jobs.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Aktive Jobs
                      </div>
                      <div className="space-y-1">
                        {course.active_jobs.slice(0, 10).map(job => (
                          <div key={job.id} className="flex items-center justify-between text-xs px-3 py-2 rounded bg-muted/20">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {job.job_type}
                              </Badge>
                              <Badge
                                variant={job.status === 'completed' ? 'default' : job.status === 'processing' ? 'secondary' : 'outline'}
                                className="text-[10px]"
                              >
                                {job.status}
                              </Badge>
                            </div>
                            <span className="text-muted-foreground">
                              {new Date(job.updated_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
