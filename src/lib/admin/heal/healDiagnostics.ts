/**
 * Heal Diagnostics API (Phase 1)
 * ──────────────────────────────
 * Thin wrappers around the hardened RPCs:
 *   - analyze_package_root_cause       → priorisierte Trigger + Empfehlung
 *   - admin_check_heal_conflicts       → Job-Konflikt-Check vor Heal
 *   - admin_auto_repair_limit_status   → Limit-Guard mit Schwellenwarnungen
 *   - admin_rollback_heal              → manuelles Rollback aus Snapshot
 *   - admin_step_reset_detailed        → einzelner Schritt-Reset mit Audit-Meta
 *
 * Plus: Reader-APIs für heal_snapshots und heal_verification_reports.
 */
import { supabase } from "@/integrations/supabase/client";

// ── Root Cause Analysis ─────────────────────────────────────
export interface RootCauseTrigger {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  count: number;
  description: string;
  recommended_action: string;
}

export interface RootCauseRecommendation {
  mode: "soft" | "hard";
  reset_from_step: string;
  enqueue_plan: Array<{ action: string }>;
  rationale: string;
}

export interface RootCauseResult {
  package_id: string;
  package_title: string;
  package_status: string;
  blocked_reason: string | null;
  active_job_count: number;
  triggers: RootCauseTrigger[];
  trigger_count: number;
  recommended: RootCauseRecommendation;
  analyzed_at: string;
}

export async function analyzePackageRootCause(packageId: string): Promise<RootCauseResult> {
  const { data, error } = await (supabase as any).rpc("analyze_package_root_cause", {
    p_package_id: packageId,
  });
  if (error) throw error;
  return data as RootCauseResult;
}

// ── Conflict Check ──────────────────────────────────────────
export interface HealConflictResult {
  package_id: string;
  active_job_count: number;
  active_jobs: Array<{
    job_id: string;
    job_type: string;
    status: string;
    attempts: number;
    created_at: string;
    locked_at: string | null;
  }>;
  conflict_count: number;
  conflicts: Array<{
    job_id: string;
    job_type: string;
    status: string;
    reason: string;
  }>;
  recommendation: "proceed" | "cancel_active_jobs_recommended" | "cancel_conflicts_first";
  checked_at: string;
}

export async function checkHealConflicts(
  packageId: string,
  plannedJobTypes?: string[],
): Promise<HealConflictResult> {
  const { data, error } = await (supabase as any).rpc("admin_check_heal_conflicts", {
    p_package_id: packageId,
    p_planned_job_types: plannedJobTypes ?? null,
  });
  if (error) throw error;
  return data as HealConflictResult;
}

// ── Limit Guard ─────────────────────────────────────────────
export interface AutoRepairLimitStatus {
  thresholds: { warn_pct: number; critical_pct: number };
  summary: {
    total_steps: number;
    exhausted: number;
    critical: number;
    warn: number;
    ok: number;
  };
  steps_at_risk: Array<{
    package_id: string;
    package_title: string;
    step_key: string;
    status: string;
    attempts: number;
    max_attempts: number;
    attempts_pct: number;
    hard_fail_count: number;
    severity: "exhausted" | "critical" | "warn" | "ok";
  }>;
  checked_at: string;
}

export async function getAutoRepairLimitStatus(
  packageId?: string,
  warnPct = 70,
  criticalPct = 90,
): Promise<AutoRepairLimitStatus> {
  const { data, error } = await (supabase as any).rpc("admin_auto_repair_limit_status", {
    p_package_id: packageId ?? null,
    p_warn_threshold_pct: warnPct,
    p_critical_threshold_pct: criticalPct,
  });
  if (error) throw error;
  return data as AutoRepairLimitStatus;
}

// ── Rollback ────────────────────────────────────────────────
export interface RollbackResult {
  snapshot_id: string;
  package_id: string;
  steps_restored: number;
  jobs_restored: boolean;
  restored_at: string;
  restored_by: string;
}

export async function rollbackHeal(
  snapshotId: string,
  operator?: string,
  restoreJobs = false,
): Promise<RollbackResult> {
  const { data, error } = await (supabase as any).rpc("admin_rollback_heal", {
    p_snapshot_id: snapshotId,
    p_operator: operator ?? null,
    p_restore_jobs: restoreJobs,
  });
  if (error) throw error;
  return data as RollbackResult;
}

// ── Detailed Step Reset ─────────────────────────────────────
export interface StepResetDetailedResult {
  ok: boolean;
  package_id: string;
  reset_count: number;
  results: Array<{
    step_key: string;
    previous_status: string;
    meta_diff: Record<string, unknown>;
    reset_at: string;
  }>;
  operator: string;
  reset_at: string;
}

export async function stepResetDetailed(
  packageId: string,
  stepKeys: string[],
  reason: string,
  operator?: string,
  options: { allowRegression?: boolean; clearExhaustion?: boolean } = {},
): Promise<StepResetDetailedResult> {
  const { data, error } = await (supabase as any).rpc("admin_step_reset_detailed", {
    p_package_id: packageId,
    p_step_keys: stepKeys,
    p_reason: reason,
    p_operator: operator ?? null,
    p_allow_regression: options.allowRegression ?? true,
    p_clear_exhaustion: options.clearExhaustion ?? true,
  });
  if (error) throw error;
  return data as StepResetDetailedResult;
}

// ── Reports & Snapshots ─────────────────────────────────────
export interface HealVerificationReport {
  id: string;
  package_id: string;
  snapshot_id: string | null;
  heal_mode: string;
  reason: string;
  package_status_before: string | null;
  package_status_after: string | null;
  blocked_reason_before: string | null;
  blocked_reason_after: string | null;
  steps_reset: unknown[];
  jobs_cancelled: number;
  recovery_jobs_planned: number;
  recovery_job_types: string[];
  conflicts: unknown;
  verify_passed: boolean;
  verify_findings: unknown[];
  created_by: string | null;
  duration_ms: number | null;
  created_at: string;
}

export async function listVerificationReports(
  packageId: string,
  limit = 20,
): Promise<HealVerificationReport[]> {
  const { data, error } = await supabase
    .from("heal_verification_reports" as never)
    .select("*")
    .eq("package_id", packageId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as HealVerificationReport[];
}

export interface HealSnapshot {
  id: string;
  package_id: string;
  created_by: string | null;
  reason: string;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  created_at: string;
}

export async function listHealSnapshots(
  packageId: string,
  limit = 20,
): Promise<HealSnapshot[]> {
  const { data, error } = await supabase
    .from("heal_snapshots" as never)
    .select("id, package_id, created_by, reason, rolled_back_at, rolled_back_by, created_at")
    .eq("package_id", packageId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as HealSnapshot[];
}
