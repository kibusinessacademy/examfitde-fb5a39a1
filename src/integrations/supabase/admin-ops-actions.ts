import { supabase } from '@/integrations/supabase/client';

export type AdminOpsAction =
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
  | 'purge_completed_jobs'
  // v5.0 Manual course controls
  | 'reset_to_step'
  | 'enqueue_single_step'
  // v6.0 Gate-Pass heal
  | 'heal_gate_pass'
  // v7.0 Context-sensitive heal (release_classification-driven)
  | 'force_publish_release_ok'
  | 'reconcile_pipeline_tail'
  | 'mark_content_gap'
  | 'bulk_heal_by_class'
  | 'zombie_sweep'
  // v8.0 Repair-Marker, Reset-Exhaustion, Hard-Rebuild
  | 'mark_repair'
  | 'unmark_repair'
  | 'reset_repair_exhaustion'
  | 'hard_depublish_and_rebuild'
  | 'bulk_reset_repair_exhaustion';

export interface ScopedPayload {
  limit?: number;
  package_id?: string;
  step_key?: string;
  step_keys?: string[];
  provider?: string;
  job_ids?: string[];
  job_type?: string;
  hours?: number;
  reason?: string;
  // v7.0 Context-sensitive heal
  package_ids?: string[];
  release_class?: 'release_ok' | 'release_block' | 'release_warn';
  older_than_minutes?: number;
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
    const err = new Error(message) as Error & { ssotBlocked?: boolean };
    // Markiere Track-Applicability-Blocks für freundliche UI-Behandlung.
    if (data && typeof data === 'object' && 'ssot_blocked' in data && data.ssot_blocked === true) {
      err.ssotBlocked = true;
    }
    throw err;
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

/* ── v5.0 Manual Course Controls ── */

export async function resetToStep(packageId: string, stepKey: string) {
  return runAdminOpsAction('reset_to_step', { package_id: packageId, step_key: stepKey });
}

export async function enqueueSingleStep(packageId: string, stepKey: string) {
  return runAdminOpsAction('enqueue_single_step', { package_id: packageId, step_key: stepKey });
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

/* ── v7.0 Context-Sensitive Heal Actions ── */

export async function forcePublishReleaseOk(packageId: string) {
  return runAdminOpsAction('force_publish_release_ok', { package_id: packageId });
}

export async function reconcilePipelineTail(packageId: string) {
  return runAdminOpsAction('reconcile_pipeline_tail', { package_id: packageId });
}

export async function markContentGap(packageId: string, reason: string) {
  return runAdminOpsAction('mark_content_gap', { package_id: packageId, reason });
}

export async function bulkHealByClass(
  releaseClass: 'release_ok' | 'release_block' | 'release_warn',
  packageIds: string[],
) {
  return runAdminOpsAction('bulk_heal_by_class', {
    release_class: releaseClass,
    package_ids: packageIds,
  });
}

export async function zombieSweep(olderThanMinutes = 30) {
  return runAdminOpsAction('zombie_sweep', { older_than_minutes: olderThanMinutes });
}

/* ── v8.0 Repair-Marker / Exhaustion-Reset / Hard-Rebuild ── */

export async function markPackageRepair(packageId: string, reason?: string) {
  return runAdminOpsAction('mark_repair', { package_id: packageId, reason });
}

export async function unmarkPackageRepair(packageId: string) {
  return runAdminOpsAction('unmark_repair', { package_id: packageId });
}

export async function resetRepairExhaustion(packageId: string, stepKeys?: string[]) {
  return runAdminOpsAction('reset_repair_exhaustion', { package_id: packageId, step_keys: stepKeys });
}

export async function hardDepublishAndRebuild(packageId: string, reason: string) {
  return runAdminOpsAction('hard_depublish_and_rebuild', { package_id: packageId, reason });
}

export async function bulkResetRepairExhaustion(packageIds: string[]) {
  return runAdminOpsAction('bulk_reset_repair_exhaustion', { package_ids: packageIds });
}
