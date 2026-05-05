/**
 * PublishBlockerCockpitPage
 * -------------------------
 * Surfaces the publish-readiness guard's audit trail and the skeleton-backfill
 * follow-up jobs so admins can see — at a glance — whether new courses are
 * being blocked from publish, whether existing skeletons are turning into real
 * lesson content, and trigger an audited admin force-publish bypass.
 *
 * Backend SSOT (all admin-gated SECURITY DEFINER):
 *   - admin_get_publish_blocked_attempts(_limit)
 *   - admin_get_skeleton_backfill_jobs_summary()
 *   - admin_force_publish_course(_course_id, _reason)
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, RefreshCcw, ShieldAlert, Zap } from 'lucide-react';
import PipelineReadinessCard from '@/components/admin/publish-blockers/PipelineReadinessCard';

type BlockedRow = {
  log_id: string;
  course_id: string | null;
  course_title: string | null;
  course_status: string | null;
  curriculum_id: string | null;
  modules: number;
  lessons: number;
  source: string | null;
  result_status: string | null;
  created_at: string;
};

type JobRow = {
  job_type: string;
  status: string;
  job_count: number;
  oldest: string | null;
  latest: string | null;
};

const REFETCH_MS = 30_000;

function statusBadgeVariant(s: string | null) {
  if (!s) return 'outline' as const;
  if (s === 'completed' || s === 'success') return 'default' as const;
  if (s === 'failed' || s === 'blocked') return 'destructive' as const;
  if (s === 'pending' || s === 'queued') return 'secondary' as const;
  if (s === 'bypassed') return 'outline' as const;
  return 'outline' as const;
}

export default function PublishBlockerCockpitPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [forceTarget, setForceTarget] = useState<BlockedRow | null>(null);
  const [reason, setReason] = useState('');

  const blocked = useQuery({
    queryKey: ['admin-publish-blocked-attempts'],
    queryFn: async (): Promise<BlockedRow[]> => {
      const { data, error } = await supabase.rpc(
        'admin_get_publish_blocked_attempts' as any,
        { _limit: 200 } as any,
      );
      if (error) throw error;
      return (data ?? []) as BlockedRow[];
    },
    refetchInterval: REFETCH_MS,
  });

  const jobs = useQuery({
    queryKey: ['admin-skeleton-backfill-jobs-summary'],
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase.rpc(
        'admin_get_skeleton_backfill_jobs_summary' as any,
      );
      if (error) throw error;
      return (data ?? []) as JobRow[];
    },
    refetchInterval: REFETCH_MS,
  });

  const forceMut = useMutation({
    mutationFn: async (input: { courseId: string; reason: string }) => {
      const { data, error } = await supabase.rpc(
        'admin_force_publish_course' as any,
        { _course_id: input.courseId, _reason: input.reason } as any,
      );
      if (error) throw error;
      return data as { ok: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (!data?.ok) {
        toast({
          title: 'Force-publish abgelehnt',
          description: data?.error ?? 'unknown error',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Force-publish erfolgreich', description: 'Audit-Log geschrieben.' });
      setForceTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin-publish-blocked-attempts'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Force-publish fehlgeschlagen',
        description: err?.message ?? String(err),
        variant: 'destructive',
      });
    },
  });

  // group jobs by job_type for the summary card
  const groupedJobs = (jobs.data ?? []).reduce<Record<string, JobRow[]>>((acc, r) => {
    (acc[r.job_type] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/cockpit"><ArrowLeft className="h-4 w-4 mr-1" /> Cockpit</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Publish Blocker Cockpit</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['admin-publish-blocked-attempts'] });
            qc.invalidateQueries({ queryKey: ['admin-skeleton-backfill-jobs-summary'] });
          }}
        >
          <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* ── Skeleton-backfill follow-up jobs ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-text-secondary" /> Skeleton-Backfill Folgejobs
          </CardTitle>
          <CardDescription>
            Status der Jobs, die <code>admin_backfill_course_skeleton</code> automatisch
            erzeugt — werden Skeletons wirklich zu Lerninhalt?
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.isLoading ? (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> lade …
            </div>
          ) : jobs.data && jobs.data.length === 0 ? (
            <div className="text-sm text-text-secondary">
              Keine Backfill-Folgejobs in der Queue.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {['lesson_generate_content', 'package_generate_lesson_minichecks', 'council_recompute_course_ready'].map((jt) => {
                const rows = groupedJobs[jt] ?? [];
                const total = rows.reduce((s, r) => s + Number(r.job_count), 0);
                return (
                  <div key={jt} className="border border-border-subtle rounded-md p-3 bg-surface-1">
                    <div className="text-xs font-mono text-text-tertiary mb-1">{jt}</div>
                    <div className="text-2xl font-semibold mb-2">{total}</div>
                    <div className="space-y-1">
                      {rows.length === 0 ? (
                        <div className="text-xs text-text-tertiary">keine Jobs</div>
                      ) : rows.map((r) => (
                        <div key={`${r.job_type}-${r.status}`} className="flex items-center justify-between text-xs">
                          <Badge variant={statusBadgeVariant(r.status)} className="font-mono">
                            {r.status}
                          </Badge>
                          <span className="font-mono">{r.job_count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Pipeline readiness (Phase 1: warn-only) ── */}
      <PipelineReadinessCard />

      {/* ── Blocked publish attempts ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-text-secondary" /> Geblockte Publish-Versuche
          </CardTitle>
          <CardDescription>
            Letzte Einträge aus <code>auto_heal_log</code> (action_type=
            <code>course_publish_readiness_blocked</code>/<code>_bypassed</code>).
            Force-Publish ist auditiert und benötigt einen Begründungstext.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blocked.isLoading ? (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> lade …
            </div>
          ) : blocked.data && blocked.data.length === 0 ? (
            <div className="text-sm text-text-secondary">
              Keine geblockten Publish-Versuche im Heal-Log. ✅
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wann</TableHead>
                  <TableHead>Kurs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Module</TableHead>
                  <TableHead className="text-right">Lessons</TableHead>
                  <TableHead>Quelle</TableHead>
                  <TableHead className="text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(blocked.data ?? []).map((r) => {
                  const blockedNow =
                    r.result_status === 'blocked' && (r.modules === 0 || r.lessons === 0);
                  return (
                    <TableRow key={r.log_id}>
                      <TableCell className="text-xs text-text-tertiary whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString('de-DE')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {r.course_title ?? <span className="text-text-tertiary italic">unbekannt</span>}
                        </div>
                        <div className="font-mono text-[10px] text-text-tertiary">
                          {r.course_id?.slice(0, 8) ?? '—'}…
                          {r.curriculum_id ? ` · cur ${r.curriculum_id.slice(0, 8)}…` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(r.result_status)} className="font-mono">
                          {r.result_status ?? '—'}
                        </Badge>
                        {r.course_status && (
                          <div className="text-[10px] text-text-tertiary mt-1">
                            course: {r.course_status}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.modules}</TableCell>
                      <TableCell className="text-right font-mono">{r.lessons}</TableCell>
                      <TableCell className="text-xs text-text-tertiary">
                        {r.source || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.course_id && blockedNow ? (
                          <Dialog
                            open={forceTarget?.log_id === r.log_id}
                            onOpenChange={(o) => {
                              if (!o) {
                                setForceTarget(null);
                                setReason('');
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setForceTarget(r)}
                              >
                                Force-Publish
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Force-Publish (auditiert)</DialogTitle>
                                <DialogDescription>
                                  Übergeht den Readiness-Guard. Dieser Bypass wird mit
                                  Admin-ID, Zeit und Begründung im <code>auto_heal_log</code>
                                  protokolliert.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-3">
                                <div className="text-sm">
                                  <div><strong>Kurs:</strong> {r.course_title}</div>
                                  <div className="font-mono text-xs text-text-tertiary">
                                    {r.course_id}
                                  </div>
                                  <div className="text-xs text-text-tertiary mt-1">
                                    modules={r.modules} · lessons={r.lessons}
                                  </div>
                                </div>
                                <Textarea
                                  placeholder="Warum trotz fehlender Module/Lessons publishen? (min. 5 Zeichen)"
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  rows={3}
                                />
                              </div>
                              <DialogFooter>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setForceTarget(null);
                                    setReason('');
                                  }}
                                >
                                  Abbrechen
                                </Button>
                                <Button
                                  variant="destructive"
                                  disabled={reason.trim().length < 5 || forceMut.isPending}
                                  onClick={() => {
                                    if (!forceTarget?.course_id) return;
                                    forceMut.mutate({
                                      courseId: forceTarget.course_id,
                                      reason: reason.trim(),
                                    });
                                  }}
                                >
                                  {forceMut.isPending && (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  )}
                                  Force-Publish bestätigen
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <span className="text-xs text-text-tertiary">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
