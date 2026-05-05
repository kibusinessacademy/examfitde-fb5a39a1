/**
 * PipelineReadinessCard
 * ---------------------
 * Phase-1 (warn-only) readiness signal for published courses.
 * Reads admin_get_course_pipeline_readiness() and offers per-course
 * Retry / Bulk-Requeue actions for the skeleton-backfill follow-up jobs.
 *
 * All actions are audited in auto_heal_log via the corresponding RPCs.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Repeat, Activity } from 'lucide-react';

const REFETCH_MS = 30_000;

type ReadinessRow = {
  course_id: string;
  title: string | null;
  course_status: string;
  curriculum_id: string | null;
  modules: number;
  lessons_total: number;
  lessons_ready: number;
  placeholder_lessons: number;
  minichecks_total: number;
  pending_jobs: number;
  failed_jobs: number;
  readiness_level:
    | 'empty' | 'skeleton' | 'content_failed' | 'content_pending'
    | 'minicheck_missing' | 'ready_to_publish';
  primary_blocker: string | null;
};

type CourseJob = {
  job_id: string;
  job_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const LEVELS: ReadinessRow['readiness_level'][] = [
  'empty', 'skeleton', 'content_failed',
  'minicheck_missing', 'content_pending', 'ready_to_publish',
];

function levelVariant(l: ReadinessRow['readiness_level']) {
  switch (l) {
    case 'empty':
    case 'content_failed':
      return 'destructive' as const;
    case 'skeleton':
    case 'minicheck_missing':
      return 'secondary' as const;
    case 'content_pending':
      return 'outline' as const;
    case 'ready_to_publish':
      return 'default' as const;
  }
}

function jobStatusVariant(s: string) {
  if (s === 'completed' || s === 'success') return 'default' as const;
  if (s === 'failed' || s === 'cancelled') return 'destructive' as const;
  if (s === 'pending' || s === 'queued') return 'secondary' as const;
  return 'outline' as const;
}

export default function PipelineReadinessCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [activeCourse, setActiveCourse] = useState<ReadinessRow | null>(null);

  const readiness = useQuery({
    queryKey: ['admin-course-pipeline-readiness', filter],
    queryFn: async (): Promise<ReadinessRow[]> => {
      const { data, error } = await supabase.rpc(
        'admin_get_course_pipeline_readiness' as any,
        {
          _readiness_filter: filter === 'all' ? null : filter,
          _limit: 200,
        } as any,
      );
      if (error) throw error;
      return (data ?? []) as ReadinessRow[];
    },
    refetchInterval: REFETCH_MS,
  });

  const counts = (readiness.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.readiness_level] = (acc[r.readiness_level] ?? 0) + 1;
    return acc;
  }, {});

  const courseJobs = useQuery({
    enabled: !!activeCourse?.course_id,
    queryKey: ['admin-skeleton-backfill-jobs-for-course', activeCourse?.course_id],
    queryFn: async (): Promise<CourseJob[]> => {
      const { data, error } = await supabase.rpc(
        'admin_get_skeleton_backfill_jobs_for_course' as any,
        { _course_id: activeCourse!.course_id } as any,
      );
      if (error) throw error;
      return (data ?? []) as CourseJob[];
    },
  });

  const retryMut = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.rpc(
        'admin_retry_skeleton_backfill_job' as any,
        { _job_id: jobId } as any,
      );
      if (error) throw error;
      return data as { ok: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (!data?.ok) {
        toast({ title: 'Retry abgelehnt', description: data?.error ?? 'unknown', variant: 'destructive' });
        return;
      }
      toast({ title: 'Job auf pending zurückgesetzt' });
      qc.invalidateQueries({ queryKey: ['admin-skeleton-backfill-jobs-for-course'] });
      qc.invalidateQueries({ queryKey: ['admin-skeleton-backfill-jobs-summary'] });
      qc.invalidateQueries({ queryKey: ['admin-course-pipeline-readiness'] });
    },
    onError: (err: any) =>
      toast({ title: 'Retry fehlgeschlagen', description: err?.message, variant: 'destructive' }),
  });

  const requeueMut = useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await supabase.rpc(
        'admin_requeue_skeleton_backfill_jobs_for_course' as any,
        { _course_id: courseId } as any,
      );
      if (error) throw error;
      return data as { ok: boolean; jobs_requeued?: number };
    },
    onSuccess: (data) => {
      toast({
        title: 'Bulk-Requeue ausgeführt',
        description: `${data?.jobs_requeued ?? 0} Job(s) auf pending gesetzt.`,
      });
      qc.invalidateQueries({ queryKey: ['admin-skeleton-backfill-jobs-for-course'] });
      qc.invalidateQueries({ queryKey: ['admin-skeleton-backfill-jobs-summary'] });
      qc.invalidateQueries({ queryKey: ['admin-course-pipeline-readiness'] });
    },
    onError: (err: any) =>
      toast({ title: 'Requeue fehlgeschlagen', description: err?.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-secondary" /> Pipeline Readiness (Phase 1: warn-only)
        </CardTitle>
        <CardDescription>
          Reifegrad pro veröffentlichtem Kurs. Heute nur Sichtbarkeit + Audit; späterer Hard-Guard
          blockt Publish unterhalb von <code>ready_to_publish</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          {LEVELS.map((l) => (
            <Badge key={l} variant={levelVariant(l)} className="font-mono">
              {l}: {counts[l] ?? 0}
            </Badge>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[200px] h-8">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Level</SelectItem>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: ['admin-course-pipeline-readiness'] })
              }
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {readiness.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> lade …
          </div>
        ) : (readiness.data ?? []).length === 0 ? (
          <div className="text-sm text-text-secondary">Keine Kurse für diesen Filter.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kurs</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Blocker</TableHead>
                <TableHead className="text-right">Mod</TableHead>
                <TableHead className="text-right">Lessons</TableHead>
                <TableHead className="text-right">Ready</TableHead>
                <TableHead className="text-right">MC</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(readiness.data ?? []).map((r) => (
                <TableRow key={r.course_id}>
                  <TableCell>
                    <div className="font-medium">{r.title ?? '—'}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">
                      {r.course_id.slice(0, 8)}…
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={levelVariant(r.readiness_level)} className="font-mono">
                      {r.readiness_level}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-text-tertiary font-mono">
                    {r.primary_blocker ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.modules}</TableCell>
                  <TableCell className="text-right font-mono">{r.lessons_total}</TableCell>
                  <TableCell className="text-right font-mono">{r.lessons_ready}</TableCell>
                  <TableCell className="text-right font-mono">{r.minichecks_total}</TableCell>
                  <TableCell className="text-right font-mono">{r.pending_jobs}</TableCell>
                  <TableCell className="text-right font-mono">{r.failed_jobs}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {r.failed_jobs > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={requeueMut.isPending}
                          onClick={() => requeueMut.mutate(r.course_id)}
                        >
                          {requeueMut.isPending && requeueMut.variables === r.course_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Repeat className="h-3 w-3" />
                          )}
                          <span className="ml-1">Requeue {r.failed_jobs}</span>
                        </Button>
                      )}
                      <Dialog
                        open={activeCourse?.course_id === r.course_id}
                        onOpenChange={(o) => setActiveCourse(o ? r : null)}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="ghost">Jobs</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle>Backfill-Jobs · {r.title}</DialogTitle>
                            <DialogDescription>
                              Pro Job einzeln retry; Bulk via Requeue-Button in der Tabelle.
                            </DialogDescription>
                          </DialogHeader>
                          {courseJobs.isLoading ? (
                            <div className="flex items-center gap-2 text-text-secondary">
                              <Loader2 className="h-4 w-4 animate-spin" /> lade …
                            </div>
                          ) : (courseJobs.data ?? []).length === 0 ? (
                            <div className="text-sm text-text-secondary">Keine Jobs für diesen Kurs.</div>
                          ) : (
                            <div className="max-h-[60vh] overflow-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Att</TableHead>
                                    <TableHead>Last Error</TableHead>
                                    <TableHead className="text-right">Aktion</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(courseJobs.data ?? []).map((j) => (
                                    <TableRow key={j.job_id}>
                                      <TableCell className="text-xs font-mono">{j.job_type}</TableCell>
                                      <TableCell>
                                        <Badge variant={jobStatusVariant(j.status)} className="font-mono">
                                          {j.status}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-mono">{j.attempts}</TableCell>
                                      <TableCell className="text-xs text-text-tertiary max-w-[280px] truncate">
                                        {j.last_error ?? '—'}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {(j.status === 'failed' || j.status === 'cancelled') && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={retryMut.isPending}
                                            onClick={() => retryMut.mutate(j.job_id)}
                                          >
                                            {retryMut.isPending && retryMut.variables === j.job_id ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <Repeat className="h-3 w-3" />
                                            )}
                                            <span className="ml-1">Retry</span>
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
