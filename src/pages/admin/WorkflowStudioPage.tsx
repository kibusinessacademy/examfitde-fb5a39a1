import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { enqueuePipeline, PIPELINE_TEMPLATES, type PipelineTemplateKey } from '@/lib/jobs/enqueue';
import {
  Rocket, Globe, ShieldCheck, Package, Play, CheckCircle2,
  Loader2, AlertTriangle, ArrowRight, Clock, Workflow, Zap, RefreshCw,
  ChevronDown, ChevronRight, RotateCcw, Wrench
} from 'lucide-react';
import { Link } from 'react-router-dom';

const ICON_MAP: Record<string, React.ElementType> = {
  Rocket, Globe, ShieldCheck, Package,
};

// Pipeline step order for progress visualization
const PIPELINE_STEPS = [
  'extract_curriculum',
  'generate_course',
  'repair_lessons',
  'seed_exam_questions',
  'enrich_exam_solutions',
  'upgrade_ihk',
  'upgrade_minichecks_v1',
  'regenerate_minichecks',
  'qc_worker_full',
  'course_finalize',
  'post_validation',
  'curriculum_smoke',
  'publish_product',
  'seo_foundation',
  'seo_audit',
] as const;

const STEP_LABELS: Record<string, string> = {
  extract_curriculum: 'Extraktion',
  generate_course: 'Generierung',
  repair_lessons: 'Reparatur',
  seed_exam_questions: 'Exam-Fragen',
  enrich_exam_solutions: 'Lösungen',
  upgrade_ihk: 'IHK-Upgrade',
  upgrade_minichecks_v1: 'MiniChecks v1',
  regenerate_minichecks: 'MiniChecks',
  qc_worker_full: 'QC Check',
  course_finalize: 'Finalisierung',
  post_validation: 'Validierung',
  curriculum_smoke: 'Smoke Test',
  publish_product: 'Publish',
  quality_gate_precheck: 'Gate Check',
  seo_foundation: 'SEO Basis',
  seo_audit: 'SEO Audit',
  seo_internal_links: 'SEO Links',
  seo_generate: 'SEO Content',
  seo_qc_check: 'SEO QC',
  seo_sitemap_refresh: 'Sitemap',
};

// Single-job types that can be manually triggered per curriculum
const MANUAL_JOBS = [
  { job_type: 'repair_lessons', label: 'Reparatur', icon: Wrench },
  { job_type: 'regenerate_minichecks', label: 'MiniChecks', icon: RotateCcw },
  { job_type: 'upgrade_ihk', label: 'IHK Upgrade', icon: Rocket },
  { job_type: 'qc_worker_full', label: 'QC Check', icon: ShieldCheck },
  { job_type: 'post_validation', label: 'Validierung', icon: CheckCircle2 },
  { job_type: 'course_finalize', label: 'Finalisieren', icon: Package },
];

interface Curriculum {
  id: string;
  title: string;
  status: string;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  payload: Record<string, unknown> | null;
  error?: string | null;
  last_error?: string | null;
}

interface CourseGroup {
  curriculum_id: string;
  curriculum_title: string;
  jobs: JobRow[];
  stats: { total: number; completed: number; failed: number; pending: number; processing: number };
  latestStep: string | null;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'failed': return <AlertTriangle className="h-4 w-4 text-destructive" />;
    case 'pending': return <Clock className="h-4 w-4 text-muted-foreground" />;
    case 'processing': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case 'completed': return 'default' as const;
    case 'failed': return 'destructive' as const;
    default: return 'outline' as const;
  }
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function WorkflowStudioPage() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [runningRunner, setRunningRunner] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const loadData = useCallback(async () => {
    const [curricResult, jobsResult] = await Promise.all([
      supabase.from('curricula').select('id, title, status').order('title'),
      supabase.from('job_queue')
        .select('id, job_type, status, created_at, payload, error, last_error')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    setCurricula((curricResult.data as Curriculum[]) || []);
    const jobs = (jobsResult.data || []) as JobRow[];

    // Group by curriculum_id
    const groupMap = new Map<string, CourseGroup>();
    const curricMap = new Map<string, string>();
    for (const c of (curricResult.data || []) as Curriculum[]) {
      curricMap.set(c.id, c.title);
    }

    for (const job of jobs) {
      const curId = (job.payload as Record<string, unknown>)?.curriculum_id as string | undefined;
      if (!curId) continue;
      if (!groupMap.has(curId)) {
        groupMap.set(curId, {
          curriculum_id: curId,
          curriculum_title: curricMap.get(curId) || curId.slice(0, 8) + '…',
          jobs: [],
          stats: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0 },
          latestStep: null,
        });
      }
      const group = groupMap.get(curId)!;
      group.jobs.push(job);
      group.stats.total++;
      if (job.status === 'completed') group.stats.completed++;
      else if (job.status === 'failed') group.stats.failed++;
      else if (job.status === 'pending') group.stats.pending++;
      else if (job.status === 'processing') group.stats.processing++;
    }

    // Determine latest step per group
    for (const group of groupMap.values()) {
      const activeJob = group.jobs.find(j => j.status === 'processing') || group.jobs.find(j => j.status === 'pending');
      group.latestStep = activeJob?.job_type || (group.stats.completed === group.stats.total ? 'done' : null);
    }

    setCourseGroups(Array.from(groupMap.values()));

    const pending = jobs.filter(j => j.status === 'pending').length;
    setPendingCount(pending);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRunPending = async () => {
    setRunningRunner(true);
    try {
      const res = await supabase.functions.invoke('job-runner', { method: 'POST', body: {} });
      if (res.error) throw res.error;
      const data = res.data as { processed?: number; results?: Array<{ outcome: string }> };
      const completed = data?.results?.filter((r) => r.outcome === 'completed').length ?? 0;
      const failed = (data?.processed ?? 0) - completed;
      toast.success(`Runner: ${completed} erledigt, ${failed} fehlgeschlagen`);
      await loadData();
    } catch (err: unknown) {
      toast.error('Runner-Fehler', { description: (err as Error).message });
    } finally {
      setRunningRunner(false);
    }
  };

  const handleTriggerJob = async (curriculumId: string, jobType: string) => {
    setTriggeringJob(jobType + curriculumId);
    try {
      const { error } = await supabase.from('job_queue').insert([{
        job_type: jobType,
        payload: { curriculum_id: curriculumId } as unknown as import('@/integrations/supabase/types').Json,
        status: 'pending' as const,
        max_attempts: 3,
      }]);
      if (error) throw error;
      toast.success(`${STEP_LABELS[jobType] || jobType} eingereiht`);
      await loadData();
    } catch (err: unknown) {
      toast.error('Fehler', { description: (err as Error).message });
    } finally {
      setTriggeringJob(null);
    }
  };

  const handleLaunch = async (templateKey: PipelineTemplateKey) => {
    if (!selectedId) {
      toast.error('Bitte ein Curriculum auswählen');
      return;
    }
    setLaunching(templateKey);
    try {
      const template = PIPELINE_TEMPLATES[templateKey];
      const result = await enqueuePipeline(selectedId, [...template.jobs]);
      toast.success(`${result?.length ?? 0} Jobs eingereiht`, { description: template.label });
      await loadData();
    } catch (err: unknown) {
      toast.error('Pipeline-Fehler', { description: (err as Error).message });
    } finally {
      setLaunching(null);
    }
  };

  const selectedCurriculum = curricula.find(c => c.id === selectedId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            Workflow Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pipeline-Übersicht nach Kurs · Fortschritt · Manuelle Trigger
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Button variant="default" size="sm" onClick={handleRunPending} disabled={runningRunner}>
              {runningRunner ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Runner läuft…</>
              ) : (
                <><Zap className="h-4 w-4 mr-1" /> {pendingCount} Jobs ausführen</>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* Course Pipeline Overview */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Pipeline-Status nach Kurs
        </h2>
        {loading ? (
          <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Lade Daten…
          </CardContent></Card>
        ) : courseGroups.length === 0 ? (
          <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground text-sm">
            Keine Jobs in der Queue
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {courseGroups.map(group => {
              const isExpanded = expandedGroups.has(group.curriculum_id);
              const progressPct = group.stats.total > 0
                ? Math.round((group.stats.completed / group.stats.total) * 100) : 0;
              const isAllDone = group.stats.completed === group.stats.total && group.stats.total > 0;
              const hasFailed = group.stats.failed > 0;
              const hasActive = group.stats.processing > 0;

              return (
                <Card key={group.curriculum_id} className="glass-card overflow-hidden">
                  {/* Group Header */}
                  <button
                    className="w-full text-left"
                    onClick={() => toggleGroup(group.curriculum_id)}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-center gap-3">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-semibold text-sm truncate">{group.curriculum_title}</span>
                            {isAllDone && <Badge className="text-[10px] bg-success/20 text-success border-success/30">✓ Fertig</Badge>}
                            {hasFailed && <Badge variant="destructive" className="text-[10px]">{group.stats.failed} Fehler</Badge>}
                            {hasActive && <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">Aktiv</Badge>}
                          </div>
                          <div className="flex items-center gap-3">
                            <Progress value={progressPct} className="flex-1 h-2" />
                            <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                              {group.stats.completed}/{group.stats.total}
                            </span>
                          </div>
                        </div>
                        {group.latestStep && group.latestStep !== 'done' && (
                          <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                            → {STEP_LABELS[group.latestStep] || group.latestStep}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </button>

                  {/* Expanded: Job Details + Manual Triggers */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* Manual Triggers */}
                      <div className="px-4 py-3 bg-muted/20 border-b border-border">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                          Job manuell starten
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {MANUAL_JOBS.map(mj => {
                            const isTriggering = triggeringJob === mj.job_type + group.curriculum_id;
                            const Icon = mj.icon;
                            return (
                              <Button
                                key={mj.job_type}
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 px-2"
                                disabled={isTriggering}
                                onClick={(e) => { e.stopPropagation(); handleTriggerJob(group.curriculum_id, mj.job_type); }}
                              >
                                {isTriggering
                                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  : <Icon className="h-3 w-3 mr-1" />
                                }
                                {mj.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Job Table */}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8"></TableHead>
                            <TableHead>Job</TableHead>
                            <TableHead className="hidden sm:table-cell">Zeitpunkt</TableHead>
                            <TableHead className="text-right">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.jobs.map(job => (
                            <TableRow key={job.id}>
                              <TableCell className="pr-0">{getStatusIcon(job.status)}</TableCell>
                              <TableCell>
                                <Link to={`/admin-v2/jobs/${job.id}`} className="hover:underline">
                                  <span className="font-mono text-xs">{STEP_LABELS[job.job_type] || job.job_type}</span>
                                </Link>
                                {job.status === 'failed' && (job.error || job.last_error) && (
                                  <p className="text-[10px] text-destructive truncate max-w-[200px]">{job.error || job.last_error}</p>
                                )}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                                {formatTime(job.created_at)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Badge variant={getStatusBadgeVariant(job.status)} className="text-[10px]">
                                  {job.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Pipeline Templates */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Pipeline-Vorlagen starten
        </h2>
        {/* Curriculum Selector */}
        <Card className="glass-card mb-4">
          <CardContent className="pt-5">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex-1 w-full">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Curriculum auswählen
                </label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loading ? 'Lade…' : 'Curriculum wählen'} />
                  </SelectTrigger>
                  <SelectContent>
                    {curricula.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <span>{c.title}</span>
                          <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedCurriculum && (
                <div className="text-xs text-muted-foreground font-mono bg-muted/30 px-3 py-2 rounded-lg">
                  {selectedCurriculum.id.slice(0, 8)}…
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.entries(PIPELINE_TEMPLATES) as [PipelineTemplateKey, typeof PIPELINE_TEMPLATES[PipelineTemplateKey]][]).map(([key, tmpl]) => {
            const Icon = ICON_MAP[tmpl.icon] || Rocket;
            const isLaunching = launching === key;
            return (
              <Card key={key} className="glass-card hover:border-primary/30 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    {tmpl.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{tmpl.description}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {tmpl.jobs.map((j, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {STEP_LABELS[j.job_type] || j.job_type}
                        </Badge>
                        {i < tmpl.jobs.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    ))}
                  </div>
                  <Button className="w-full" size="sm" disabled={!selectedId || isLaunching} onClick={() => handleLaunch(key)}>
                    {isLaunching ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Wird eingereiht…</>
                    ) : (
                      <><Play className="h-4 w-4 mr-1" /> Workflow starten</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
