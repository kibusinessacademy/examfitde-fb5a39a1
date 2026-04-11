import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import type { OpsJobItem } from '@/components/admin/lib/admin-types';

export interface AdminQueueJob {
  job_id: string;
  job_type: string;
  job_status: string;
  priority: number | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  run_after: string | null;
  package_id: string | null;
  package_title: string | null;
  package_status: string | null;
  meta: Record<string, unknown> | null;
  age_minutes: number;
  health_signal: 'zombie' | 'stale_lock' | 'exhausted' | 'retriable' | 'aging' | 'normal';
}

export interface QueueCounts {
  pending: number;
  processing: number;
  failed: number;
  completed_1h: number;
  cancelled: number;
  total: number;
}

type QueueHealthSignal = AdminQueueJob['health_signal'];

function toMinutesAgo(ts: string | null | undefined): number {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 60000);
}

function inferHealthSignal(status: string, attempts: number, maxAttempts: number, lastError: string | null, startedAt?: string | null): QueueHealthSignal {
  if (status === 'failed' && maxAttempts > 0 && attempts >= maxAttempts) return 'exhausted';
  if (status === 'failed') return 'retriable';
  if (status === 'processing') {
    if (lastError?.toLowerCase().includes('stale')) return 'stale_lock';
    const runMin = toMinutesAgo(startedAt);
    if (runMin > 30) return 'zombie';
    if (runMin > 10) return 'aging';
  }
  return 'normal';
}

function toAgeMinutes(createdAt: string | null | undefined) {
  if (!createdAt) return 0;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

function normalizeQueueJob(row: Partial<AdminQueueJob>): AdminQueueJob {
  const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
  const attempts = typeof row.attempts === 'number' ? row.attempts : 0;
  const maxAttempts = typeof row.max_attempts === 'number' ? row.max_attempts : 0;
  const lastError = typeof row.last_error === 'string' ? row.last_error : null;
  const jobStatus = typeof row.job_status === 'string' ? row.job_status : 'pending';
  const rawHealth = row.health_signal as string | undefined;
  const healthSignal: QueueHealthSignal = rawHealth === 'ok' ? 'normal'
    : rawHealth && ['zombie', 'stale_lock', 'exhausted', 'retriable', 'aging', 'normal'].includes(rawHealth)
    ? (rawHealth as QueueHealthSignal)
    : inferHealthSignal(jobStatus, attempts, maxAttempts, lastError, typeof row.started_at === 'string' ? row.started_at : null);

  return {
    job_id: typeof row.job_id === 'string' && row.job_id.length > 0
      ? row.job_id
      : `${typeof row.job_type === 'string' ? row.job_type : 'job'}-${createdAt}`,
    job_type: typeof row.job_type === 'string' && row.job_type.length > 0 ? row.job_type : 'unknown_job',
    job_status: jobStatus,
    priority: typeof row.priority === 'number' ? row.priority : null,
    attempts,
    max_attempts: maxAttempts,
    created_at: createdAt,
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    locked_at: typeof row.locked_at === 'string' ? row.locked_at : null,
    locked_by: typeof row.locked_by === 'string' ? row.locked_by : null,
    last_error: lastError,
    run_after: typeof row.run_after === 'string' ? row.run_after : null,
    package_id: typeof row.package_id === 'string' ? row.package_id : null,
    package_title: typeof row.package_title === 'string' ? row.package_title : null,
    package_status: typeof row.package_status === 'string' ? row.package_status : null,
    meta: row.meta && typeof row.meta === 'object' ? row.meta : null,
    age_minutes: typeof row.age_minutes === 'number' ? row.age_minutes : toAgeMinutes(createdAt),
    health_signal: healthSignal,
  };
}

function mapLegacyJob(job: OpsJobItem): AdminQueueJob {
  return normalizeQueueJob({
    job_id: job.job_id,
    job_type: job.job_type,
    job_status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    created_at: job.created_at,
    last_error: job.error,
    package_title: job.package_title,
  });
}

/**
 * Server-side counts — never truncated by row limits.
 */
export function useAdminQueueCounts() {
  return useQuery<QueueCounts>({
    queryKey: ['admin', 'queue-counts'],
    queryFn: async () => {
      const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

      const [pending, processing, failed, completed1h, cancelled] = await Promise.all([
        supabase.from('job_queue').select('id', { head: true, count: 'exact' }).in('status', ['pending', 'queued']),
        supabase.from('job_queue').select('id', { head: true, count: 'exact' }).in('status', ['processing', 'running', 'batch_pending']),
        supabase.from('job_queue').select('id', { head: true, count: 'exact' }).eq('status', 'failed'),
        supabase.from('job_queue').select('id', { head: true, count: 'exact' }).eq('status', 'completed').gte('updated_at', oneHourAgo),
        supabase.from('job_queue').select('id', { head: true, count: 'exact' }).eq('status', 'cancelled'),
      ]);

      return {
        pending: pending.count ?? 0,
        processing: processing.count ?? 0,
        failed: failed.count ?? 0,
        completed_1h: completed1h.count ?? 0,
        cancelled: cancelled.count ?? 0,
        total: (pending.count ?? 0) + (processing.count ?? 0) + (failed.count ?? 0),
      };
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useAdminQueueSSOT(statusFilter?: string) {
  return useQuery({
    queryKey: ['admin', 'queue-ssot', statusFilter],
    queryFn: async (): Promise<AdminQueueJob[]> => {
      // Map UI filter to actual DB statuses
      const statusMap: Record<string, string[]> = {
        pending: ['pending', 'queued'],
        processing: ['processing', 'running', 'batch_pending'],
        failed: ['failed'],
        completed: ['completed'],
        cancelled: ['cancelled'],
      };

      // Default: show active statuses only
      const statuses = statusFilter && statusFilter !== 'all'
        ? statusMap[statusFilter] || [statusFilter]
        : ['pending', 'queued', 'processing', 'running', 'batch_pending', 'failed'];

      try {
        const query = (supabase as any)
          .from('v_admin_queue_ssot')
          .select('*')
          .in('job_status', statuses)
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(200);

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          return data.map((row: any) => normalizeQueueJob(row as Partial<AdminQueueJob>));
        }
        console.warn('[admin-queue] SSOT view error, using fallback:', error?.message);
      } catch (e) {
        console.warn('[admin-queue] SSOT query exception, using fallback:', e);
      }

      // Fallback: edge function
      try {
        const fallbackJobs = await adminRpc.opsQueueOverview();
        return fallbackJobs.map(mapLegacyJob).slice(0, 200);
      } catch (e) {
        console.warn('[admin-queue] Fallback also failed:', e);
        return [];
      }
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
}
