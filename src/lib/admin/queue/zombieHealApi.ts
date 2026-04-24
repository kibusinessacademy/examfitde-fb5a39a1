/**
 * zombieHealApi
 * ─────────────
 * Thin client wrappers for the zombie-locked-job heal RPCs added in migration
 * 20260424_zombie_auto_heal (+ v1.1 + v1.2 hardening).
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
): Promise<{ ok: boolean; error?: string; step_reset?: boolean; step_reset_count?: number }> {
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

/**
 * Per-job heal result — strukturierter failure_code aus dem Backend.
 */
export interface TargetedHealResult {
  job_id: string;
  ok: boolean;
  failure_code?: string;
  current_status?: string;
  locked_at?: string | null;
  step_reset?: boolean;
  step_reset_count?: number;
  detail?: unknown;
  /** legacy free-text error, falls Backend keinen failure_code liefert. */
  error?: string;
}

export interface TargetedHealResponse {
  ok: boolean;
  total: number;
  ok_count: number;
  fail_count: number;
  results: TargetedHealResult[];
}

export async function listRecentIntegrityJobs(
  packageId: string,
  limit = 5,
): Promise<Array<{ id: string; status: string; created_at: string; last_error: string | null; locked_by: string | null; locked_at: string | null; attempts: number }>> {
  const { data, error } = await supabase
    .from("job_queue")
    .select("id,status,created_at,last_error,locked_by,locked_at,attempts")
    .eq("package_id", packageId)
    .eq("job_type", "package_run_integrity_check")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as any;
}

/**
 * NEW: Backend-validierter Targeted Heal.
 * Re-checked je job_id Eligibility zur Ausführungszeit und liefert strukturierte
 * per-job Failure-Codes (job_not_found | not_eligible_status | lock_too_fresh | …).
 */
export async function healJobsTargetedBackend(
  jobIds: string[],
  reason = "runbook_targeted_heal",
): Promise<TargetedHealResponse> {
  const { data, error } = await supabase.rpc(
    "admin_heal_jobs_targeted" as any,
    { _job_ids: jobIds, _reason: reason },
  );
  if (error) throw new Error(error.message);
  return data as TargetedHealResponse;
}

/**
 * Legacy sequenzieller Client-Heal (für Fallback-Tests / Vergleich).
 */
export async function healJobsTargeted(
  jobIds: string[],
  reason = "runbook_targeted_heal",
): Promise<TargetedHealResult[]> {
  const results: TargetedHealResult[] = [];
  for (const jobId of jobIds) {
    try {
      const res = await healZombieLockedJob(jobId, reason);
      results.push({
        job_id: jobId,
        ok: !!res.ok,
        error: res.ok ? undefined : res.error,
        failure_code: res.ok ? undefined : (res.error ?? "heal_rpc_failed"),
        step_reset: res.step_reset,
        step_reset_count: res.step_reset_count,
      });
    } catch (e) {
      results.push({
        job_id: jobId,
        ok: false,
        failure_code: "client_exception",
        error: (e as Error).message,
      });
    }
  }
  return results;
}

/**
 * Computes the diff between current job status and the post-heal target status.
 * Used by the Runbook "What will change" preview to block no-op heals.
 */
export interface JobHealDiff {
  job_id: string;
  current_status: string;
  next_status: string;
  current_locked_by: string | null;
  next_locked_by: string | null;
  step_will_reset: boolean;
  /** false → kein effektiver Diff, Heal sollte blockiert werden. */
  has_effective_change: boolean;
  reason?: string;
}

export function computeHealDiff(job: {
  id: string;
  status: string;
  locked_by: string | null;
  locked_at: string | null;
}): JobHealDiff {
  const eligibleStatus = job.status === "processing" || job.status === "running";
  const locked = !!job.locked_by;
  const stale = job.locked_at
    ? Date.now() - new Date(job.locked_at).getTime() > 15 * 60_000
    : false;

  if (!eligibleStatus) {
    return {
      job_id: job.id,
      current_status: job.status,
      next_status: job.status,
      current_locked_by: job.locked_by,
      next_locked_by: job.locked_by,
      step_will_reset: false,
      has_effective_change: false,
      reason: "status_not_eligible",
    };
  }

  if (!locked || !stale) {
    return {
      job_id: job.id,
      current_status: job.status,
      next_status: job.status,
      current_locked_by: job.locked_by,
      next_locked_by: job.locked_by,
      step_will_reset: false,
      has_effective_change: false,
      reason: "lock_too_fresh",
    };
  }

  return {
    job_id: job.id,
    current_status: job.status,
    next_status: "cancelled",
    current_locked_by: job.locked_by,
    next_locked_by: null,
    step_will_reset: true,
    has_effective_change: true,
  };
}

/**
 * Audit Export — formatiert Heal/Requeue Aktionen als CSV oder JSON.
 */
export interface AuditExportRow {
  job_id: string;
  action: "safe_requeue" | "targeted_heal";
  ok: boolean;
  prev_step_state?: string;
  new_step_state?: string;
  prev_job_status?: string;
  new_job_status?: string;
  reason: string;
  failure_code?: string;
  ts: string;
}

export function exportAuditAsCsv(rows: AuditExportRow[]): string {
  const header = [
    "ts",
    "action",
    "ok",
    "job_id",
    "prev_job_status",
    "new_job_status",
    "prev_step_state",
    "new_step_state",
    "reason",
    "failure_code",
  ];
  const escape = (v: unknown) => {
    if (v === undefined || v === null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.ts,
        r.action,
        r.ok,
        r.job_id,
        r.prev_job_status,
        r.new_job_status,
        r.prev_step_state,
        r.new_step_state,
        r.reason,
        r.failure_code,
      ].map(escape).join(","),
    );
  }
  return lines.join("\n");
}

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
