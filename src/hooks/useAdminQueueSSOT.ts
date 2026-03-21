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

type QueueFilters = { status?: string; jobType?: string };

type QueueHealthSignal = AdminQueueJob['health_signal'];

function inferHealthSignal(status: string, attempts: number, maxAttempts: number, lastError: string | null): QueueHealthSignal {
  if (status === 'failed' && maxAttempts > 0 && attempts >= maxAttempts) return 'exhausted';
  if (status === 'failed') return 'retriable';
  if (status === 'processing' && lastError?.toLowerCase().includes('stale')) return 'stale_lock';
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
    : inferHealthSignal(jobStatus, attempts, maxAttempts, lastError);

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

function applyFilters(jobs: AdminQueueJob[], filters?: QueueFilters) {
  let list = jobs;

  if (filters?.status) {
    list = list.filter((job) => job.job_status === filters.status);
  }

  if (filters?.jobType) {
    list = list.filter((job) => job.job_type === filters.jobType);
  }

  return [...list]
    .sort((a, b) => {
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .slice(0, 500);
}

export function useAdminQueueSSOT(filters?: QueueFilters) {
  return useQuery({
    queryKey: ['admin', 'queue-ssot', filters],
    queryFn: async () => {
      try {
        let query = (supabase as any)
          .from('v_admin_queue_ssot')
          .select('*')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(500);

        if (filters?.status) {
          query = query.eq('job_status', filters.status);
        }
        if (filters?.jobType) {
          query = query.eq('job_type', filters.jobType);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          return data.map((row) => normalizeQueueJob(row as Partial<AdminQueueJob>));
        }

        console.warn('[admin-queue] SSOT view unavailable, falling back to edge response', error?.message);
      } catch (error) {
        console.warn('[admin-queue] SSOT query failed, falling back to edge response', error);
      }

      const fallbackJobs = await adminRpc.opsQueueOverview();
      return applyFilters(fallbackJobs.map(mapLegacyJob), filters);
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
}
