import { supabase } from '@/integrations/supabase/client';

type AdminOpsAction =
  | 'requeue_failed_jobs'
  | 'release_provider_cooldowns'
  | 'reset_stalled_steps'
  | 'cancel_zombie_packages';

export async function runAdminOpsAction(
  action: AdminOpsAction,
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await supabase.functions.invoke('admin-ops-actions', {
    body: { action, ...payload },
  });

  if (error) throw error;
  return data;
}
