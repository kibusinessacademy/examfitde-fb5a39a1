import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditAction {
  id: string;
  action: string;
  scope: string | null;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  affected_ids: string[] | null;
  created_at: string;
}

export interface SystemHealth {
  queue_pending: number;
  queue_processing: number;
  queue_failed: number;
  active_leases: number;
  last_cron: string | null;
}

export function useAdminAuditLog(filters?: { limit?: number }) {
  return useQuery({
    queryKey: ['admin-audit-log', filters?.limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(filters?.limit ?? 100);
      if (error) throw error;
      return (data ?? []) as unknown as AuditAction[];
    },
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin-system-health'],
    queryFn: async () => {
      const [queueRes, leaseRes] = await Promise.all([
        supabase.from('job_queue').select('status', { count: 'exact', head: false })
          .in('status', ['pending', 'queued', 'processing', 'running', 'failed'])
          .limit(1000),
        supabase.from('package_leases').select('id', { count: 'exact', head: true })
          .gt('expires_at', new Date().toISOString()),
      ]);

      const jobs = (queueRes.data ?? []) as any[];
      const pending = jobs.filter(j => j.status === 'pending' || j.status === 'queued').length;
      const processing = jobs.filter(j => j.status === 'processing' || j.status === 'running').length;
      const failed = jobs.filter(j => j.status === 'failed').length;

      return {
        queue_pending: pending,
        queue_processing: processing,
        queue_failed: failed,
        active_leases: leaseRes.count ?? 0,
        last_cron: null,
      } as SystemHealth;
    },
    refetchInterval: 15_000,
  });
}
