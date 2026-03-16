import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

export function useAdminQueueSSOT(filters?: { status?: string; jobType?: string }) {
  return useQuery({
    queryKey: ['admin', 'queue-ssot', filters],
    queryFn: async () => {
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
      if (error) throw error;
      return data as AdminQueueJob[];
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
}
