/**
 * zombieHealApi
 * ─────────────
 * Thin client wrappers for the zombie-locked-job heal RPCs added in migration
 * 20260424_zombie_auto_heal.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ZombieJob {
  job_id: string;
  job_type: string;
  package_id: string | null;
  status: string;
  attempts: number;
  locked_at: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  locked_by: string | null;
  age_minutes: number;
  zombie_reason: string;
}

export async function detectZombieLockedJobs(ageMin = 15): Promise<ZombieJob[]> {
  const { data, error } = await supabase.rpc(
    "admin_detect_zombie_locked_jobs" as any,
    { _age_min: ageMin },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ZombieJob[];
}

export async function healZombieLockedJob(
  jobId: string,
  reason = "manual_admin_heal",
): Promise<{ ok: boolean; error?: string; step_reset?: boolean }> {
  const { data, error } = await supabase.rpc(
    "admin_heal_zombie_locked_job" as any,
    { _job_id: jobId, _reason: reason },
  );
  if (error) throw new Error(error.message);
  return data as any;
}

export async function safeRequeueIntegrityCheck(
  packageId: string,
  reason = "manual_admin_requeue",
): Promise<{ ok: boolean; error?: string; job_id?: string }> {
  const { data, error } = await supabase.rpc(
    "admin_safe_requeue_integrity_check" as any,
    { _package_id: packageId, _reason: reason },
  );
  if (error) throw new Error(error.message);
  return data as any;
}

export async function markRequeueLoopTerminal(
  jobId: string,
  reason = "requeue_loop_manual_review",
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc(
    "admin_mark_requeue_loop_terminal" as any,
    { _job_id: jobId, _reason: reason },
  );
  if (error) throw new Error(error.message);
  return data as any;
}

export interface JobCancelAuditSummary {
  ok: boolean;
  job_id?: string;
  job_type?: string;
  status?: string;
  package_id?: string;
  attempts?: number;
  reason_code?: string | null;
  last_error?: string | null;
  step_key?: string | null;
  step_status?: string | null;
  started_at?: string | null;
  last_heartbeat_at?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  completed_at?: string | null;
  admin_actions?: Array<{
    id: string;
    action: string;
    reason?: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>;
  reconciler_actions?: Array<{
    id: string;
    action: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>;
}

export async function getJobCancelAuditSummary(
  jobId: string,
): Promise<JobCancelAuditSummary> {
  const { data, error } = await supabase.rpc(
    "admin_get_job_cancel_audit_summary" as any,
    { _job_id: jobId },
  );
  if (error) throw new Error(error.message);
  return data as JobCancelAuditSummary;
}

export interface IntegrityRunbook {
  ok: boolean;
  package_id?: string;
  step?: Record<string, unknown> | null;
  last_job?: Record<string, unknown> | null;
  causes?: Array<{
    kind: "stale_lock" | "ghost_finalization" | "orphan_no_job" | "requeue_loop";
    severity: "high" | "medium" | "low";
    title: string;
    detail: string;
    heal_action: string;
    heal_target: string;
  }>;
  flags?: {
    stale_lock: boolean;
    ghost_finalization: boolean;
    orphan_no_job: boolean;
    requeue_loop: boolean;
  };
}

export async function getIntegrityRunbook(
  packageId: string,
): Promise<IntegrityRunbook> {
  const { data, error } = await supabase.rpc(
    "admin_get_run_integrity_runbook" as any,
    { _package_id: packageId },
  );
  if (error) throw new Error(error.message);
  return data as IntegrityRunbook;
}
