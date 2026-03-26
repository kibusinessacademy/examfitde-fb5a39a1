import { supabase } from '@/integrations/supabase/client';

type AdminOpsAction =
  | 'requeue_failed_jobs'
  | 'release_provider_cooldowns'
  | 'reset_stalled_steps'
  | 'cancel_zombie_packages'
  | 'recover_failed_packages'
  | 'root_cause_summary'
  | 'kill_stale_processing_jobs'
  | 'release_stale_leases'
  // Workspace SSOT actions
  | 'retry_package_step'
  | 'cancel_package_build'
  | 'force_unlock_package'
  | 'unblock_package'
  | 'approve_step_exception'
  | 'workspace_snapshot'
  // v2 loop smoke test
  | 'smoke_test_v2_loop'
  // Batch recovery
  | 'heal_finalization_stall'
  | 'heal_non_building';

export interface ScopedPayload {
  limit?: number;
  package_id?: string;
  step_key?: string;
  provider?: string;
  job_ids?: string[];
  job_type?: string;
  hours?: number;
  reason?: string;
}

export async function runAdminOpsAction(
  action: AdminOpsAction,
  payload: ScopedPayload = {},
) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('admin-ops-actions', {
    body: { action, ...payload },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {},
  });

  if (error) throw error;
  return data;
}

/* ── Typed convenience wrappers for Workspace actions ── */

export async function retryPackageStep(packageId: string, stepKey: string) {
  return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: stepKey });
}

export async function cancelPackageBuild(packageId: string) {
  return runAdminOpsAction('cancel_package_build', { package_id: packageId });
}

export async function forceUnlockPackage(packageId: string) {
  return runAdminOpsAction('force_unlock_package', { package_id: packageId });
}

export async function approveStepException(packageId: string, stepKey: string, reason: string) {
  return runAdminOpsAction('approve_step_exception', { package_id: packageId, step_key: stepKey, reason });
}

export async function getWorkspaceSnapshot(packageId: string) {
  return runAdminOpsAction('workspace_snapshot', { package_id: packageId });
}

export async function unblockPackage(packageId: string, reason: string) {
  return runAdminOpsAction('unblock_package', { package_id: packageId, reason });
}

/* ── v2 Loop Smoke Test ── */

export async function runV2LoopSmokeTest(curriculumId: string, userId?: string, dryRun = false) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('ops-smoke-test-v2-loop', {
    body: {
      curriculum_id: curriculumId,
      ...(userId ? { user_id: userId } : {}),
      dry_run: dryRun,
    },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {},
  });
  if (error) throw error;
  return data;
}
