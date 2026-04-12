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
  // Force-run
  | 'force_run_job'
  // Batch recovery
  | 'heal_finalization_stall'
  | 'heal_non_building'
  | 'repair_lessons'
  | 'repair_handbook'
  | 'repair_minichecks'
  | 'repair_oral_exam'
  | 'repair_exam_pool_quality'
  | 'retry_stalled_step'
  // v3.0 Safety-Net actions
  | 'reset_stale_processing'
  | 'cancel_zombie_noop_jobs'
  // v4.0 Full reset & ghost heal
  | 'full_queue_reset'
  | 'heal_ghost_completions'
  | 'purge_completed_jobs';

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
  if (data && typeof data === 'object' && 'ok' in data && data.ok === false) {
    const message = 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Admin action failed: ${action}`;
    throw new Error(message);
  }
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

/* ── Batch Recovery ── */

export async function healFinalizationStall(limit = 20) {
  return runAdminOpsAction('heal_finalization_stall', { limit });
}

export async function healNonBuilding(limit = 20) {
  return runAdminOpsAction('heal_non_building', { limit });
}

/* ── Targeted Repair Actions ── */

export async function repairLessons(packageId: string) {
  return runAdminOpsAction('repair_lessons', { package_id: packageId });
}

export async function repairHandbook(packageId: string) {
  return runAdminOpsAction('repair_handbook', { package_id: packageId });
}

export async function repairMinichecks(packageId: string) {
  return runAdminOpsAction('repair_minichecks', { package_id: packageId });
}

export async function repairOralExam(packageId: string) {
  return runAdminOpsAction('repair_oral_exam', { package_id: packageId });
}

export async function repairExamPoolQuality(packageId: string) {
  return runAdminOpsAction('repair_exam_pool_quality', { package_id: packageId });
}

export async function retryStalledStep(packageId: string, stepKey: string) {
  return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: stepKey });
}

/* ── v3.0 Safety-Net Actions ── */

export async function resetStaleProcessingJobs() {
  return runAdminOpsAction('reset_stale_processing');
}

export async function cancelZombieNoopJobs() {
  return runAdminOpsAction('cancel_zombie_noop_jobs');
}

export async function fullQueueReset() {
  return runAdminOpsAction('full_queue_reset');
}

export async function healGhostCompletions() {
  return runAdminOpsAction('heal_ghost_completions');
}

export async function purgeCompletedJobs(hours = 24) {
  return runAdminOpsAction('purge_completed_jobs', { hours });
}

/* ── Legacy Exempt Actions ── */

export async function markLegacyExempt(packageId: string, reason: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.email ?? 'admin';
  const { data, error } = await supabase.rpc('fn_mark_legacy_exempt', {
    p_package_id: packageId,
    p_reason: reason,
    p_set_by: userId,
  });
  if (error) throw error;
  return data;
}

export async function removeLegacyExempt(packageId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.email ?? 'admin';
  const { data, error } = await supabase.rpc('fn_remove_legacy_exempt', {
    p_package_id: packageId,
    p_set_by: userId,
  });
  if (error) throw error;
  return data;
}
