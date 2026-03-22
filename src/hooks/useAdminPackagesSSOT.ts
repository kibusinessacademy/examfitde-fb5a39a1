import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AdminPackageSSOT {
  package_id: string;
  raw_title: string | null;
  curriculum_id: string | null;
  status: string;
  track: string | null;
  priority: number | null;
  build_progress: number | null;
  current_step: string | null;
  blocked_reason: string | null;
  stuck_reason: string | null;
  last_progress_at: string | null;
  council_approved: boolean | null;
  council_approved_at: string | null;
  integrity_passed: boolean | null;
  published_at: string | null;
  is_published: boolean | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  queue_position: number | null;
  locked_at: string | null;
  canonical_title: string | null;
  beruf_id: string | null;
  beruf_display_name: string | null;
  steps_done: number;
  steps_functional: number;
  council_sessions_total: number;
  council_sessions_pending: number;
  council_sessions_processing: number;
  council_sessions_completed: number;
  council_sessions_approved: number;
  approved_questions: number;
  total_questions: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  last_job_completed_at: string | null;
  last_job_error: string | null;
  has_stale_publish: boolean;
  is_stuck: boolean;
  council_complete: boolean;
  has_publish_drift: boolean;
}

export function useAdminPackagesSSOT() {
  return useQuery({
    queryKey: ['admin', 'packages-ssot'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_admin_packages_ssot')
        .select('*')
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as AdminPackageSSOT[];
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}
