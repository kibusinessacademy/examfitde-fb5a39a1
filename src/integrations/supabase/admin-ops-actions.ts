import { supabase } from '@/integrations/supabase/client';

type AdminOpsAction =
  | 'requeue_failed_jobs'
  | 'release_provider_cooldowns'
  | 'reset_stalled_steps'
  | 'cancel_zombie_packages'
  | 'recover_failed_packages'
  | 'root_cause_summary';

export interface ScopedPayload {
  limit?: number;
  package_id?: string;
  step_key?: string;
  provider?: string;
  job_ids?: string[];
  job_type?: string;
  hours?: number;
}

export async function runAdminOpsAction(
  action: AdminOpsAction,
  payload: ScopedPayload = {},
) {
  const { data, error } = await supabase.functions.invoke('admin-ops-actions', {
    body: { action, ...payload },
  });

  if (error) throw error;
  return data;
}
