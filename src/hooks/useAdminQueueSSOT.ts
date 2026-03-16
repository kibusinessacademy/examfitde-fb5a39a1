import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AdminQueueJob {
  job_id: string;
  job_type: string;
  job_status: string;
  job_priority: number | null;
  attempts: number;
  max_attempts: number;
  job_created_at: string;
  job_started_at: string | null;
  job_completed_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_severity: string | null;
  last_heartbeat_at: string | null;
  liveness_status: string | null;
  run_after: string | null;
  rate_limited_until: string | null;
  package_id: string | null;
  worker_pool: string | null;
  fallback_count: number | null;
  parent_job_id: string | null;
  package_raw_title: string | null;
  package_status: string | null;
  package_current_step: string | null;
  package_blocked_reason: string | null;
  age_seconds: number;
  health_signal: 'zombie' | 'stale_lock' | 'exhausted' | 'retriable' | 'aging' | 'normal';
}

export function useAdminQueueSSOT(filters?: { status?: string; jobType?: string }) {
  return useQuery({
    queryKey: ['admin', 'queue-ssot', filters],
    queryFn: async () => {
      let query = (supabase as any)
        .from('v_admin_queue_ssot')
        .select('*')
        .order('job_priority', { ascending: true })
        .order('job_created_at', { ascending: true })
        .limit(500);

      if (filters?.status) {
        query = query.eq('job_status', filters.status);
      }
      if (filters?.jobType) {
        query = query.eq('job_type', filters.jobType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as AdminQueueJob[];
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
}
